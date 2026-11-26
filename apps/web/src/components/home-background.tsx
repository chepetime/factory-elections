'use client';
// The homepage background: one of several animated WebGL scenes on black, with arrows at the bottom
// left that step through them. The choice saves to the user's preferences.
import { useEffect, useRef, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import { HOME_BACKGROUNDS, type HomeBackground as BackgroundId } from '@factory/core';
import { saveHomeBackground } from '@/app/actions';
import { CRTWarp } from '@/components/backdrops/crt-warp';
import { Dither } from '@/components/backdrops/dither';
import { FaultyTerminal } from '@/components/backdrops/faulty-terminal';
import { LineWaves } from '@/components/backdrops/line-waves';
import { useUserPreferences } from '@/components/user-preferences';

const LABELS: Record<BackgroundId, string> = {
  dither: 'Dithered waves',
  'faulty-terminal': 'Faulty terminal',
  'line-waves': 'Line waves',
  'crt-warp': 'CRT warp',
};

/** Wait this long after the last arrow press before saving, so fast stepping saves once. */
const SAVE_DELAY_MS = 600;

function Scene({ id }: { id: BackgroundId }) {
  switch (id) {
    case 'faulty-terminal':
      return (
        <FaultyTerminal
          tint="#E4E4E7"
          glyphs="characters"
          scale={2.4}
          digitSize={1.1}
          timeScale={0.5}
          brightness={0.7}
          glow={0.35}
          persistence={0.5}
          mouseStrength={0.5}
          mouseGlow={0.6}
          curvature={0.16}
          vignette={0.25}
          clickEffect="none"
          scramble={0.9}
          mouseReact={false}
        />
      );
    case 'line-waves':
      return (
        <LineWaves
          color1="#ffffff"
          color2="#ffffff"
          color3="#ffffff"
          speed={0.3}
          lineCount={72}
          lineWidth={1.3}
          highlight={1}
          warpIntensity={1}
          rotation={-33}
          enableMouseInteraction
          clickRipple={false}
        />
      );
    case 'crt-warp':
      return (
        <CRTWarp
          color="#e8ecff"
          backgroundColor="#120f17"
          mask="shadow"
          curvature={0.5}
          persistence={0.25}
          speed={0.6}
          levels={5}
          columns={96}
          corners={0.7}
          scanlineStrength={0.55}
          scanlineFrequency={240}
          maskStrength={0.55}
          bloom={1.3}
          rgbShift={0.004}
          vignette={0.5}
          changeOnClick={false}
        />
      );
    default:
      return (
        <Dither
          waveColor="#bcbcbc"
          backgroundColor="#000000"
          ditherMode="bayer"
          colorNum={4}
          pixelSize={2}
          waveSpeed={0.05}
          waveFrequency={3}
          waveAmplitude={0.3}
          mouseEffect="erase"
          mouseRadius={0.3}
          clickRipple={false}
        />
      );
  }
}

/** The active background, full bleed. Switching cross-fades, and the new scene plays its own intro. */
export function HomeBackground() {
  const saved = useUserPreferences().preferences.home_background ?? 'dither';
  const [active, setActive] = useState<BackgroundId>(saved);
  const reduceMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [, start] = useTransition();

  useEffect(() => () => clearTimeout(timer.current), []);

  const step = (by: 1 | -1) => {
    const index = HOME_BACKGROUNDS.indexOf(active);
    const next = HOME_BACKGROUNDS[(index + by + HOME_BACKGROUNDS.length) % HOME_BACKGROUNDS.length]!;
    setActive(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      start(async () => {
        await saveHomeBackground(next);
      });
    }, SAVE_DELAY_MS);
  };

  const arrow =
    'flex size-8 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11';

  return (
    <LazyMotion features={domAnimation}>
      <div aria-hidden="true" className="absolute inset-0">
        <AnimatePresence initial={false}>
          <m.div
            key={active}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
          >
            <Scene id={active} />
          </m.div>
        </AnimatePresence>
      </div>
      <div
        role="group"
        aria-label="Background"
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-lg border border-white/15 bg-black/50 p-1 text-white backdrop-blur-sm"
      >
        <button type="button" className={arrow} aria-label="Previous background" onClick={() => step(-1)}>
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span aria-live="polite" className="min-w-28 px-1 text-center text-xs text-white/80 select-none">
          {LABELS[active]}
        </span>
        <button type="button" className={arrow} aria-label="Next background" onClick={() => step(1)}>
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </LazyMotion>
  );
}
