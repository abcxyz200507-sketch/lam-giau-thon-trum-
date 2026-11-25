import React, { useEffect, useRef } from 'react';

const YOUTUBE_VIDEO_ID = 'SVJ-_Kcihz8';

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  setVolume: (vol: number) => void;
  destroy: () => void;
}

interface YTEvent {
  data: number;
  target: YTPlayer;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: YTEvent) => void;
            onStateChange?: (event: YTEvent) => void;
            onError?: () => void;
          };
        }
      ) => YTPlayer;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface BackgroundMusicProps {
  enabled: boolean;
  soundEnabled: boolean;
  onStatusChange?: (playing: boolean) => void;
}

export const BackgroundMusic: React.FC<BackgroundMusicProps> = ({
  enabled,
  soundEnabled,
  onStatusChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const isReadyRef = useRef<boolean>(false);
  const enabledRef = useRef<boolean>(enabled);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const userInteractedRef = useRef<boolean>(false);

  enabledRef.current = enabled;
  soundEnabledRef.current = soundEnabled;

  // Sync play/pause & mute state whenever user toggles music or master sound
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;
    try {
      if (enabled && soundEnabled) {
        player.unMute();
        player.setVolume(65);
        player.playVideo();
      } else if (!enabled) {
        player.pauseVideo();
      } else {
        player.mute();
      }
    } catch {
      // Ignore YouTube iframe transient state errors
    }
  }, [enabled, soundEnabled]);

  // Unlock browser autoplay immediately on first user interaction anywhere on the page
  useEffect(() => {
    let unlocked = false;
    const unlockAudio = () => {
      userInteractedRef.current = true;
      if (unlocked) return;
      const player = playerRef.current;
      if (!player || !isReadyRef.current) return;
      unlocked = true;
      try {
        if (enabledRef.current && soundEnabledRef.current) {
          player.unMute();
          player.setVolume(65);
          player.playVideo();
        }
      } catch {
        // Ignore
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Load YouTube IFrame API and initialize background audio player
  useEffect(() => {
    let mounted = true;

    const initPlayer = () => {
      if (!mounted || !containerRef.current || !window.YT?.Player || playerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: YOUTUBE_VIDEO_ID,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          loop: 1,
          modestbranding: 1,
          playlist: YOUTUBE_VIDEO_ID,
          playsinline: 1,
          rel: 0,
          origin: typeof window !== 'undefined' ? window.location.origin : '',
        },
        events: {
          onReady: (event) => {
            if (!mounted) return;
            isReadyRef.current = true;
            try {
              event.target.setVolume(65);
              if (enabledRef.current && soundEnabledRef.current) {
                event.target.unMute();
                event.target.playVideo();
              } else {
                event.target.mute();
              }
            } catch {
              // Ignore
            }
          },
          onStateChange: (event) => {
            if (!mounted) return;
            const endedState = window.YT?.PlayerState?.ENDED ?? 0;
            const playingState = window.YT?.PlayerState?.PLAYING ?? 1;
            onStatusChange?.(event.data === playingState);

            // Guarantee seamless infinite loop of full YouTube audio
            if (event.data === endedState && enabledRef.current) {
              try {
                event.target.playVideo();
              } catch {
                // Ignore
              }
            }
          },
          onError: () => {
            onStatusChange?.(false);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        initPlayer();
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
      }
    }

    return () => {
      mounted = false;
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignore
      }
      playerRef.current = null;
      isReadyRef.current = false;
    };
  }, [onStatusChange]);

  return (
    <div
      className="fixed -left-[9999px] -top-[9999px] w-[200px] h-[200px] opacity-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <div ref={containerRef} />
    </div>
  );
};
