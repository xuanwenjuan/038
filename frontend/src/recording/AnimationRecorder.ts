export type RecordingState = 'idle' | 'recording' | 'stopped';

export class AnimationRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private state: RecordingState = 'idle';
  private onStart?: () => void;
  private onStop?: (blob: Blob) => void;
  private onError?: (err: ErrorEvent) => void;

  constructor(callbacks?: {
    onStart?: () => void;
    onStop?: (blob: Blob) => void;
    onError?: (err: ErrorEvent) => void;
  }) {
    this.onStart = callbacks?.onStart;
    this.onStop = callbacks?.onStop;
    this.onError = callbacks?.onError;
  }

  getState(): RecordingState {
    return this.state;
  }

  start(canvas: HTMLCanvasElement, fps: number = 30): boolean {
    if (this.state === 'recording') return false;

    try {
      const stream = canvas.captureStream(fps);

      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];

      let mimeType = '';
      for (const mt of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mt)) {
          mimeType = mt;
          break;
        }
      }

      if (!mimeType) {
        console.error('浏览器不支持 WebM 录制');
        return false;
      }

      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });

      this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        this.state = 'stopped';
        this.onStop?.(blob);
      };

      this.mediaRecorder.onerror = (e: Event) => {
        this.onError?.(e as ErrorEvent);
        this.state = 'idle';
      };

      this.mediaRecorder.start(100);
      this.state = 'recording';
      this.onStart?.();
      return true;
    } catch (e) {
      console.error('录制启动失败:', e);
      return false;
    }
  }

  stop(): void {
    if (this.state !== 'recording' || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
  }

  static download(blob: Blob, filename: string = 'wind-field-animation.webm'): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
