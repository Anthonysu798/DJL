import { Composition, registerRoot } from "remotion";
import { RemoteScene, REMOTE_SCENE_FRAMES } from "../src/components/settings/remote/RemoteScene";

function Root() {
  return (
    <Composition
      id="DJLRemote"
      component={RemoteScene}
      durationInFrames={REMOTE_SCENE_FRAMES}
      fps={30}
      width={840}
      height={350}
    />
  );
}
registerRoot(Root);
