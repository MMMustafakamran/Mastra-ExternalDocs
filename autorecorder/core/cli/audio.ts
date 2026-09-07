/**
 * Adds a narration track to a recorded video.
 *
 * Playwright records silent WebM — there is no audio device in a headless
 * capture and no way to ask for one. A voiceover therefore has to be muxed in
 * afterwards, which is also the right order of work: the narration is written
 * against a clip that already exists, and re-recording the clip does not mean
 * re-recording the voice.
 *
 * Two details this gets right, both of which are silent failures otherwise:
 *
 * - **WebM cannot carry AAC.** An `.m4a` copied straight into a WebM container
 *   produces a file that plays video and no sound in most players, with no
 *   error at mux time. The audio is transcoded to Opus.
 * - **Neither stream is truncated to the other.** If the voice runs past the
 *   picture the final frame is held; if the picture runs past the voice it
 *   plays out in silence. ffmpeg's `-shortest` would quietly cut whichever
 *   finished last, which is how a clip loses its closing explanation.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface MuxResult {
  videoSeconds: number;
  audioSeconds: number;
  /** Frames held at the end so the narration could finish. */
  paddedSeconds: number;
}

export class AudioMuxError extends Error {}

function ffprobeDuration(file: string): number {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf-8' },
  );
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) {
    throw new AudioMuxError(`Could not read a duration from ${file}`);
  }
  return seconds;
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Muxes `audioPath` into `videoPath`, in place.
 *
 * Writes to a sibling temp file and renames over the original only on success,
 * so a failed mux cannot leave a half-written video where a good one was.
 */
export function muxAudio(videoPath: string, audioPath: string): MuxResult {
  if (!existsSync(videoPath)) throw new AudioMuxError(`No video at ${videoPath}`);
  if (!existsSync(audioPath)) throw new AudioMuxError(`No audio at ${audioPath}`);
  if (!hasFfmpeg()) {
    throw new AudioMuxError(
      'ffmpeg is not on PATH, so narration cannot be added. Install it, or re-run without audio.',
    );
  }

  const videoSeconds = ffprobeDuration(videoPath);
  const audioSeconds = ffprobeDuration(audioPath);
  const padding = Math.max(0, audioSeconds - videoSeconds);

  const temp = join(dirname(videoPath), `.muxing-${Date.now()}.webm`);

  // Video is stream-copied when it does not need extending, which is seconds
  // rather than minutes for a 1080p clip. Padding needs a filter, and a filter
  // means re-encoding — accepted only when the alternative is losing narration.
  const args = padding > 0.05
    ? [
        '-y', '-i', videoPath, '-i', audioPath,
        '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${padding.toFixed(2)}[v]`,
        '-map', '[v]', '-map', '1:a',
        '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
        '-c:a', 'libopus', '-b:a', '128k',
        temp,
      ]
    : [
        // No -shortest. Narration is usually shorter than the clip, and
        // -shortest would cut the picture at the moment the voice stopped —
        // silently discarding whatever the video still had to show. Without it
        // ffmpeg runs to the longest stream, so the video plays out in full and
        // the last stretch is simply silent.
        '-y', '-i', videoPath, '-i', audioPath,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy',
        '-c:a', 'libopus', '-b:a', '128k',
        temp,
      ];

  try {
    execFileSync('ffmpeg', args, { stdio: 'ignore' });
  } catch (e) {
    rmSync(temp, { force: true });
    throw new AudioMuxError(
      `ffmpeg failed muxing ${audioPath} into ${videoPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  renameSync(temp, videoPath);

  return {
    videoSeconds: Number(videoSeconds.toFixed(1)),
    audioSeconds: Number(audioSeconds.toFixed(1)),
    paddedSeconds: Number(padding.toFixed(1)),
  };
}
