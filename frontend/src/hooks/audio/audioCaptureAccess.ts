/** Optional host consent boundary. The ordinary web app uses browser consent. */
export interface AudioCaptureAccessPolicy {
  beforeCapture: () => Promise<void>;
  canEnumerateDevices: () => boolean;
}

let hostPolicy: AudioCaptureAccessPolicy | undefined;

/** Install before rendering microphone consumers; dispose when the host exits. */
export function installAudioCaptureAccessPolicy(
  policy: AudioCaptureAccessPolicy,
) {
  const previous = hostPolicy;
  hostPolicy = policy;
  return () => {
    if (hostPolicy === policy) hostPolicy = previous;
  };
}

export async function requestAudioStream(
  mediaDevices: MediaDevices,
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  const policy = hostPolicy;
  if (policy) {
    await policy.beforeCapture();
    if (hostPolicy !== policy) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- internal cancellation, mapped by callers
      throw new DOMException("Audio host was closed", "AbortError");
    }
  }
  return mediaDevices.getUserMedia(constraints);
}

export function enumerateAudioDevices(mediaDevices: MediaDevices) {
  // Enumeration on mount must neither prompt nor invalidate a saved device ID
  // based on the empty list returned by an Office iframe before consent.
  if (hostPolicy && !hostPolicy.canEnumerateDevices()) {
    return Promise.resolve<MediaDeviceInfo[]>([]);
  }
  return mediaDevices.enumerateDevices();
}
