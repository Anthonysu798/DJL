import type { PlasmoCSConfig } from "plasmo";
import { handleBilibiliImageUpload } from "./helper/bilibili";
import { handleBlueskyImageUpload, handleBlueskyVideoUpload } from "./helper/bluesky";
import { handleJianpianUpload, prepareJianpianInput } from "./helper/jianpian";
import { handleWeiboVideoUpload, prepareWeiboVideoInput } from "./helper/weibo";
import { handleXiaoheiheImageUpload, handleXiaoheiheVideoUpload } from "./helper/xiaoheihe";

export const config: PlasmoCSConfig = {
  matches: [
    "https://t.bilibili.com/*",
    "https://bsky.app/*",
    "https://www.v2ex.com/write*",
    "https://v2ex.com/write*",
    "https://www.xiaoheihe.cn/creator/editor/*",
    "https://weibo.com/upload/channel*",
    "https://www.jianpian.cn/p/edit*",
  ],
  world: "MAIN",
  run_at: "document_start",
};

interface CodeMirrorElement extends HTMLDivElement {
  CodeMirror: {
    setValue: (content: string) => void;
  };
}

const originalCreateElement = document.createElement.bind(document);
export const createdInputs: HTMLInputElement[] = [];

document.createElement = (tagName, options) => {
  const element = originalCreateElement(tagName, options);

  if (tagName.toLowerCase() === "input") {
    createdInputs.push(element);
    prepareWeiboVideoInput(element);
    prepareJianpianInput(element);
  }
  return element;
};

function handleMessage(event: MessageEvent) {
  if (event.source !== window || !event.data || typeof event.data !== "object") {
    return;
  }

  const data = event.data;

  if (data.type === "BILIBILI_DYNAMIC_UPLOAD_IMAGES") {
    handleBilibiliImageUpload(event);
  } else if (data.type === "BLUESKY_VIDEO_UPLOAD") {
    handleBlueskyVideoUpload(event);
  } else if (data.type === "BLUESKY_IMAGE_UPLOAD") {
    handleBlueskyImageUpload(event);
  } else if (data.type === "V2EX_DYNAMIC_UPLOAD") {
    const editor = document.querySelector(".CodeMirror") as CodeMirrorElement;
    if (editor) {
      editor.CodeMirror.setValue(data.content);
    }
  } else if (data.type === "XIAOHEIHE_IMAGE_UPLOAD") {
    handleXiaoheiheImageUpload(event);
  } else if (data.type === "XIAOHEIHE_VIDEO_UPLOAD") {
    handleXiaoheiheVideoUpload(event);
  } else if (data.type === "WEIBO_UPLOAD_VIDEO") {
    handleWeiboVideoUpload(event);
  } else if (data.type === "JIANPIAN_UPLOAD") {
    handleJianpianUpload(event);
  }
}

// 添加事件监听器
window.addEventListener("message", handleMessage);
