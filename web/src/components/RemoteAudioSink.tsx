import type { RemotePeerAudio } from '../lib/media';

/** Hidden <audio> elements that actually play every remote speaker's stream. */
export default function RemoteAudioSink({ peers }: { peers: RemotePeerAudio[] }) {
  return (
    <>
      {peers.map((peer) => (
        <audio
          key={peer.peerId}
          ref={(el) => {
            if (el && el.srcObject !== peer.stream) {
              el.srcObject = peer.stream;
              el.autoplay = true;
            }
          }}
          hidden
        />
      ))}
    </>
  );
}
