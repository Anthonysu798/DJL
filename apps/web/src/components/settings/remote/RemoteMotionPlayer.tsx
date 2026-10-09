import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RemoteScene, REMOTE_SCENE_FRAMES } from "./RemoteScene";

export default function RemoteMotionPlayer({ visible }: { visible: boolean }) {
  const { t } = useTranslation("settings");
  const player = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const userPaused = useRef(false);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    current.addEventListener("play", onPlay);
    current.addEventListener("pause", onPause);
    return () => {
      current.removeEventListener("play", onPlay);
      current.removeEventListener("pause", onPause);
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      if (visible && !document.hidden && !userPaused.current) player.current?.play();
      else player.current?.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [visible]);
  return (
    <>
      <div aria-hidden="true">
        <Player
          ref={player}
          component={RemoteScene}
          durationInFrames={REMOTE_SCENE_FRAMES}
          compositionWidth={840}
          compositionHeight={350}
          fps={30}
          controls={false}
          loop
          // This composition is silent; never wait for browser audio permission.
          initiallyMuted
          numberOfSharedAudioTags={0}
          style={{ width: "100%" }}
        />
      </div>
      <button
        type="button"
        className="remote-motion-control"
        aria-label={t(playing ? "remote.design.pause" : "remote.design.play")}
        onClick={() => {
          if (playing) {
            userPaused.current = true;
            player.current?.pause();
          } else {
            userPaused.current = false;
            player.current?.play();
          }
        }}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {playing ? (
            <path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" />
          ) : (
            <path d="m7 5 8 5-8 5Z" fill="currentColor" />
          )}
        </svg>
      </button>
    </>
  );
}
