"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import type {
  CommerceAddressLookupResult,
  CommerceAddressSuggestion,
} from "@synara/contracts/cloud";
import { api } from "@/lib/api";

import styles from "./shop.module.css";

const endpoint = "/v1/commerce/address-lookup";
const debounceMs = 300;
const province = /^(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/;
const postalCode = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i;

type LookupWork = { controller: AbortController; timer?: number };
type LookupState =
  | { status: "idle" | "loading" | "empty" | "error" }
  | { status: "suggestions"; suggestions: CommerceAddressSuggestion[]; work: LookupWork }
  | { status: "resolved"; address: CommerceAddressLookupResult };
type LookupReply = { suggestions?: unknown; address?: unknown };
type LookupInput = { sessionToken: string } & ({ query: string } | { placeId: string });

function isSuggestion(value: unknown): value is CommerceAddressSuggestion {
  const item = value as Partial<CommerceAddressSuggestion> | null;
  return (
    typeof item?.placeId === "string" &&
    /^[\w-]{1,512}$/.test(item.placeId) &&
    typeof item.label === "string" &&
    Boolean(item.label.trim())
  );
}

function isCanadianAddress(value: unknown): value is CommerceAddressLookupResult {
  const address = value as Partial<CommerceAddressLookupResult> | null;
  return (
    address?.country === "CA" &&
    typeof address.line1 === "string" &&
    Boolean(address.line1.trim()) &&
    (address.line2 === undefined || typeof address.line2 === "string") &&
    typeof address.city === "string" &&
    Boolean(address.city.trim()) &&
    typeof address.province === "string" &&
    province.test(address.province) &&
    typeof address.postalCode === "string" &&
    postalCode.test(address.postalCode)
  );
}

export function CanadianAddressLookup() {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LookupState>({ status: "idle" });
  const noteId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const session = useRef<string | null>(null);
  const current = useRef<LookupWork | null>(null);
  const stopWork = useCallback(() => {
    const work = current.current;
    current.current = null;
    if (work?.timer !== undefined) window.clearTimeout(work.timer);
    work?.controller.abort();
  }, []);

  useLayoutEffect(() => {
    const capability = new AbortController();
    const { signal } = capability;
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return api<{ enabled?: unknown } | null>(endpoint, {
          method: "GET",
          cache: "no-store",
          signal,
        });
      })
      .then((reply) => {
        if (!signal.aborted && reply?.enabled === true) setEnabled(true);
      })
      .catch(() => {
        // Optional feature: an unconfirmed deployment must not offer any input.
      });
    return () => {
      capability.abort();
      stopWork();
      session.current = null;
    };
  }, [stopWork]);

  useLayoutEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  function run(
    work: LookupWork,
    json: LookupInput,
    project: (reply: LookupReply | null) => LookupState,
  ) {
    const { signal } = work.controller;
    void api<LookupReply | null>(endpoint, { method: "POST", json, signal })
      .then((reply) => {
        if (current.current === work && !signal.aborted) setState(project(reply));
      })
      .catch(() => {
        if (current.current === work && !signal.aborted) setState({ status: "error" });
      });
  }

  function edit(value: string) {
    stopWork();
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setState({ status: "idle" });
      return;
    }
    if (trimmed.length > 150 || /[\r\n\t]/.test(trimmed) || !crypto.randomUUID) {
      setState({ status: "error" });
      return;
    }
    const sessionToken = (session.current ??= crypto.randomUUID());
    const work: LookupWork = { controller: new AbortController() };
    current.current = work;
    setState({ status: "loading" });
    work.timer = window.setTimeout(() => {
      if (current.current !== work || work.controller.signal.aborted) return;
      run(work, { query: trimmed, sessionToken }, (reply) => {
        if (!Array.isArray(reply?.suggestions) || !reply.suggestions.every(isSuggestion))
          return { status: "error" };
        const suggestions = [
          ...new Map(reply.suggestions.map((item) => [item.placeId, item])).values(),
        ].slice(0, 5);
        return suggestions.length
          ? { status: "suggestions", suggestions, work }
          : { status: "empty" };
      });
    }, debounceMs);
  }

  function select(suggestion: CommerceAddressSuggestion, source: LookupWork) {
    const sessionToken = session.current;
    if (!sessionToken || current.current !== source || source.controller.signal.aborted) return;
    stopWork();
    // A details request ends this suggestion session even if its response is lost.
    session.current = null;
    const work = { controller: new AbortController() };
    current.current = work;
    setState({ status: "loading" });
    run(work, { placeId: suggestion.placeId, sessionToken }, (reply) =>
      isCanadianAddress(reply?.address)
        ? { status: "resolved", address: reply.address }
        : { status: "error" },
    );
  }

  function clear() {
    stopWork();
    session.current = null;
    setQuery("");
    setState({ status: "idle" });
    setActive(false);
  }

  if (!enabled) return null;
  return (
    <section className={styles.panel} aria-label="加拿大地址查找">
      <h3>加拿大地址查找</h3>
      <p id={noteId} className={styles.small}>
        继续后，会把输入的地址查询和所选建议的编号发送给 <span translate="no">Google Maps</span>
        。请勿填写姓名、电话或其他资料。这里只用于查找，不保存地址、不下单，也不保证可以配送。
      </p>
      {!active ? (
        <button
          type="button"
          className={styles.secondary}
          aria-describedby={noteId}
          onClick={() => setActive(true)}
        >
          查找加拿大地址
        </button>
      ) : (
        <>
          <label className={styles.field}>
            输入加拿大地址
            <input
              ref={input}
              value={query}
              maxLength={150}
              placeholder="例如：50"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={noteId}
              onChange={(event) => edit(event.target.value)}
              onKeyDown={(event) => {
                // This lookup does not submit an enclosing checkout form.
                if (event.key === "Enter") event.preventDefault();
                if (event.key === "ArrowDown") {
                  const first = list.current?.querySelector("button");
                  if (first) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            />
          </label>
          {state.status === "idle" ? (
            <p className={styles.small}>请输入至少 2 个字符，例如门牌号 50。</p>
          ) : null}
          {state.status === "loading" ? <p role="status">正在查找地址…</p> : null}
          {state.status === "empty" ? (
            <p role="status">没有合适建议。可以加上街道或城市名称后再试。</p>
          ) : null}
          {state.status === "error" ? (
            <div>
              <p role="alert">
                暂时无法确认这个地址。请核对输入后重试，或自行记录地址；这里不会保存地址或提交订单。
              </p>
              {query.trim().length >= 2 ? (
                <button type="button" className={styles.secondary} onClick={() => edit(query)}>
                  重试地址查找
                </button>
              ) : null}
            </div>
          ) : null}
          {state.status === "suggestions" ? (
            <div ref={list} role="group" aria-label="地址建议" className={styles.orderList}>
              <p className={styles.small} translate="no">
                Google Maps
              </p>
              {state.suggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  type="button"
                  className={styles.secondary}
                  onClick={() => select(suggestion, state.work)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}
          {state.status === "resolved" ? (
            <section aria-label="所选加拿大地址">
              <p role="status">已填入地址预览，请核对；没有保存或下单。</p>
              <p className={styles.small}>
                地址资料由 <span translate="no">Google Maps</span> 提供。
              </p>
              <label className={styles.field}>
                街道地址
                <input readOnly value={state.address.line1} />
              </label>
              <label className={styles.field}>
                单元号
                <input readOnly value={state.address.line2 ?? ""} placeholder="未提供" />
              </label>
              <label className={styles.field}>
                城市
                <input readOnly value={state.address.city} />
              </label>
              <label className={styles.field}>
                省／地区
                <input readOnly value={state.address.province} />
              </label>
              <label className={styles.field}>
                邮政编码
                <input readOnly value={state.address.postalCode} />
              </label>
            </section>
          ) : null}
          <button type="button" className={styles.secondary} onClick={clear}>
            清除并结束查找
          </button>
        </>
      )}
    </section>
  );
}
