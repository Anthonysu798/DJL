import { readInstagramEvidence, type VerificationContext } from "./verification";
import { assertPreparedContent } from "./preparation";
import { resolveDomIdentity } from "./identity";
import { normalizeContent } from "./content";
import turndownSource from "./turndown.json";
import { getAdapter, identitySources } from "./index";

/** Kept closure-free because the desktop serializes this gate into a sandboxed page. */
export function createSubmissionGate() {
  const pending: (() => Promise<void>)[] = [];
  let cancelled = false;
  let submitted = false;
  let evidence: { postUrl: string } | null = null;
  let dispatched = false;
  return {
    defer(action: () => Promise<void>) {
      if (cancelled) throw new Error("Publishing cancelled");
      pending.push(action);
    },
    get pending() {
      return pending.length;
    },
    get dispatched() {
      return dispatched;
    },
    get evidence() {
      return evidence;
    },
    perform<T>(action: () => T) {
      if (submitted) dispatched = true;
      if (cancelled) throw new Error("Publishing cancelled");
      return action();
    },
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      if (cancelled) throw new Error("Publishing cancelled");
      if (submitted && init?.method && init.method.toUpperCase() !== "GET") dispatched = true;
      // Inline media was already read and authorized by the host. Decode locally:
      // a page's connect-src policy can reject fetch(data:) even for owned bytes.
      const inline =
        typeof input === "string" ? /^data:([^,]*);base64,([\s\S]*)$/.exec(input) : null;
      const response = inline
        ? new Response(
            Uint8Array.from(atob(inline[2]!), (value) => value.charCodeAt(0)),
            {
              headers: { "Content-Type": inline[1] || "application/octet-stream" },
            },
          )
        : await fetch(input, init);
      if (submitted && response.ok && init?.method?.toUpperCase() === "POST")
        try {
          const value = (await response.clone().json()) as Record<string, unknown>;
          const url = value.postUrl ?? value.post_url ?? value.permalink;
          if (typeof url === "string") {
            const parsed = new URL(url);
            if (
              parsed.protocol === "https:" ||
              (parsed.protocol === "http:" &&
                ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
            )
              evidence = { postUrl: url };
          }
        } catch {}
      return response;
    },
    async submit(authorized: boolean) {
      if (!authorized) throw new Error("Publishing authorization is required");
      if (cancelled) throw new Error("Publishing cancelled");
      if (submitted) throw new Error("Publishing already submitted");
      if (!pending.length) throw new Error("This adapter requires manual final submission");
      submitted = true;
      while (pending.length) {
        if (cancelled) throw new Error("Publishing cancelled");
        await pending.shift()!();
      }
    },
    cancel() {
      cancelled = true;
      pending.length = 0;
    },
  };
}
export function buildPreparationScript(adapterId: string, data: unknown, extraConfig: unknown) {
  const adapter = getAdapter(adapterId);
  const payload = {
    platforms: [{ name: adapterId, extraConfig }],
    isAutoPublish: adapter.automaticSubmit,
    data: normalizeContent(adapter.kind, data as { title: string }),
    origin: structuredClone(data),
  };
  const prelude = adapter.kind === "article" ? turndownSource : "";
  return `(async()=>{${prelude};const gate=(${createSubmissionGate.toString()})();const state={...gate,done:false,error:null,startedAt:Date.now()};Object.defineProperty(state,'pending',{get:()=>gate.pending});Object.defineProperty(state,'evidence',{get:()=>gate.evidence});Object.defineProperty(state,'dispatched',{get:()=>gate.dispatched});globalThis.__djlMultiPost=state;const adapterConsole=Object.create(console);adapterConsole.error=(...args)=>{state.error=String(args.find(value=>value instanceof Error)?.message??args[0]??"Platform preparation failed").replace(/(?:https?:\\/\\/|data:)\\S+/g,"[media URL]").slice(0,240);};try{const payload=${JSON.stringify(payload)};if(payload.data.htmlContent&&!payload.data.markdownContent&&typeof TurndownService!=='undefined'){payload.data.markdownContent=new TurndownService().turndown(payload.data.htmlContent);payload.origin=structuredClone(payload.data);}const run=(()=>{const console=adapterConsole;${adapter.source}})();await run(payload);if(state.error)throw new Error(state.error);(${assertPreparedContent.toString()})(${JSON.stringify(adapterId)},payload.data,document,gate.pending);state.done=true;return {done:true,pending:gate.pending};}catch(error){state.error=String(error?.message??error);state.done=true;throw error;}})()`;
}
export const buildSubmissionScript = () =>
  `(async()=>{const state=globalThis.__djlMultiPost;if(!state||!state.done||state.error)throw new Error('Preparation is incomplete');state.submissionHrefs=[...document.querySelectorAll('a[href]')].map(node=>node.href);state.submissionHeadings=[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(node=>node.textContent??'');state.submissionNotices=[...document.querySelectorAll('[role="status"],[role="alert"],.notice-success')].map(node=>node.textContent??'');await state.submit(true);return {dispatched:state.dispatched};})()`;
export const buildCancelScript = () => `(()=>{globalThis.__djlMultiPost?.cancel();return true;})()`;
export function buildIdentityScript(platformKey: string) {
  const source = identitySources[platformKey];
  return `(async()=>{${source ? `try{const run=(()=>{${source}})();const account=await run();if(account?.accountId)return {provider:${JSON.stringify(platformKey)},accountId:String(account.accountId),username:String(account.username??account.accountId),verifiedAt:new Date().toISOString()};}catch{}` : ""}
  const key=${JSON.stringify(platformKey)};if(!['instagram','linkedin','threads','youtube'].includes(key))return null;
  const read=(${resolveDomIdentity.toString()});for(let attempt=0;attempt<20;attempt++){const identity=read(key,document,location.href);if(identity)return identity;await new Promise(resolve=>setTimeout(resolve,100));}return null;})()`;
}
/** Provider evidence only: the workbench does not infer success from a closed dialog. */
export function buildVerificationScript(context?: VerificationContext) {
  return `(()=>{const state=globalThis.__djlMultiPost;const now=new Date().toISOString();const uncertain={state:'uncertain',message:'Submission dispatched; verify the result on the platform.',observedAt:now};const instagram=(${readInstagramEvidence.toString()})(document,typeof location==='undefined'?'':location.href,${JSON.stringify(context)},state);if(instagram)return instagram;if(!state?.dispatched)return uncertain;const evidence=state.evidence;if(evidence?.postUrl)return {state:"published",postUrl:evidence.postUrl,observedAt:now};if(!Array.isArray(state.submissionHrefs))return uncertain;const candidates=[...document.querySelectorAll('a[href]')].filter(x=>!state.submissionHrefs.includes(x.href)&&/view (post|video)|查看(作品|帖子)|查看发布/.test(x.textContent?.toLowerCase()??''));const result=candidates.find(x=>/^https:\\/\\//.test(x.href)&&/(\\/status\\/|\\/p\\/|\\/reel\\/|\\/video\\/|watch\\?v=|\\/posts\\/|\\/explore\\/)/.test(x.href));return result?{state:'published',postUrl:result.href,observedAt:now}:uncertain;})()`;
}

export function buildNativeScheduleVerificationScript() {
  return `(()=>{const state=globalThis.__djlMultiPost;if(!state?.dispatched||!Array.isArray(state.submissionNotices))return false;return [...document.querySelectorAll('[role="status"],[role="alert"],.notice-success')].some(node=>{const text=node.textContent??'';return !state.submissionNotices.includes(text)&&/scheduled successfully|successfully scheduled|定时发布成功|已定时|预约成功/i.test(text);});})()`;
}
