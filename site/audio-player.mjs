import { keyOf } from './core.mjs';

// Made By 冷踢踢。只讓目前這次播放接收事件，避免換詞後舊錄音繼續出聲。
export function createAudioPlayer(audio, timeout = 20000) {
  let active = null;
  const stop = () => {
    const previous = active;
    active = null;
    previous?.cleanup();
    audio.pause();
    previous?.resolve(false);
  };
  return {
    stop,
    play(sources, onPlaying = () => {}) {
      stop();
      return new Promise((resolve, reject) => {
        let index = 0,
          attempt = 0,
          timer;
        const task = {
          resolve,
          cleanup: () => {
            clearTimeout(timer);
            audio.removeEventListener('ended', ended);
            audio.removeEventListener('error', failed);
          },
        };
        const finish = (result) => {
          if (active !== task) return;
          active = null;
          task.cleanup();
          if (typeof result !== 'boolean') {
            audio.pause();
            reject(result);
          } else resolve(result);
        };
        const next = async () => {
          if (active !== task) return;
          clearTimeout(timer);
          if (index >= sources.length) {
            finish(new Error('音檔暫時無法播放，請確認網路後再試一次。'));
            return;
          }
          const current = ++attempt;
          audio.src = sources[index++];
          timer = setTimeout(() => {
            if (active === task && current === attempt) next();
          }, timeout);
          try {
            await audio.play();
            if (active !== task || current !== attempt) return;
            clearTimeout(timer);
            onPlaying();
          } catch (error) {
            if (active !== task || current !== attempt) return;
            if (error.name === 'NotAllowedError') finish(error);
            else next();
          }
        };
        const ended = () => finish(true);
        const failed = () => {
          if (audio.error) next();
        };
        active = task;
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', failed);
        next();
      });
    },
  };
}

export function studyAudioTracks(target, mode, options = []) {
  if (mode === 'meaning-sound')
    return options.flatMap((entry, i) =>
      entry.audio ? [{ key: keyOf(entry), label: `錄音 ${i + 1}` }] : [],
    );
  return target?.audio ? [{ key: keyOf(target), label: '' }] : [];
}

export function createStudyAutoplay(play, stop) {
  let generation = 0,
    last = null;
  const cancel = () => {
    generation++;
    last = null;
    stop();
  };
  return {
    cancel,
    async run(id, tracks) {
      if (last === id) return;
      cancel();
      last = id;
      const ticket = generation;
      for (const track of tracks) {
        if (ticket !== generation || !(await play(track))) return;
      }
    },
  };
}
