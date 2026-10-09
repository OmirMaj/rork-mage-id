/**
 * Smoke: the Living Model's 3D view on the phone (lane PHONE3D), on a build
 * that HAS the 3D engine. components/livingModel/JobReplay3D.tsx is the file
 * jest resolves, the same one iOS and Android bundle.
 *
 * There is no drawing surface under jest, and jest cannot run a dynamic
 * import, so three things are faked and handed over through the entry file's
 * `loadEngine` seam:
 *   expo            the optional lookup answers "the native module is here"
 *   expo-gl         a GLView that hands over a context with the three calls
 *                   the phone makes itself (the buffer size, endFrameEXP, getError)
 *   threeScene      a scene that writes down what it was asked to do
 * The picture itself was proven in the iOS Simulator
 * (docs/phone-3d-build-notes.md). The finger and size arithmetic runs under
 * bun with planted breaks (scripts/validate-phone-3d.ts). This file proves
 * what the COMPONENTS do.
 *
 *   1  the engine is in the build: the 3D view mounts, builds the scene on the phone's own context, in points at the
 *      buffer's pixels a point, draws a frame and shows it
 *   2  nothing is drawn again until something changes; a new moment draws one more frame
 *   3  a room's label is ordinary text placed over the drawing, and takes no touch
 *   4  a tap picks the room under the finger, asked of the scene in points; a second tap lets it go
 *   5  Cut Away Walls builds the shapes again; Reset View draws one frame
 *   6  leaving gives the scene back
 *   7  a scene that will not start ends on the flat replay with the plain sentence, and the screen is still up
 *   8  a frame that throws ends on the flat replay, once
 *   9  the app leaving the front stops the frames; coming back draws one
 *  10  Standard on a 3x phone lays the drawing surface out at two thirds and grows it back, with a 1024 shadow map;
 *      High is the whole surface with a 2048 one, on a new drawing surface
 *  11  a finger on the model holds the page; lifting, or leaving with the finger down, gives it back
 *  12  the screen is told which is on the glass: 3D, or the flat replay
 *  13  a drawing surface that never starts ends on the flat replay
 */
import React from 'react';
import { AppState, PixelRatio, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => ({ colors, resolved: 'light', pref: 'light', setPref: () => {} }) };
});

jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }),
    // The screen is in front for the whole test: run the effect as an ordinary one.
    useFocusEffect: (fn: () => void | (() => void)) => { R.useEffect(fn, [fn]); },
  };
});

jest.mock('expo', () => {
  const actual = jest.requireActual('expo');
  return { ...actual, requireOptionalNativeModule: (name: string) => (name === 'ExponentGLObjectManager' ? {} : actual.requireOptionalNativeModule(name)) };
});

let mockSurfaceStarts = true;
const mockGl = { drawingBufferWidth: 1170, drawingBufferHeight: 1140, shown: 0, endFrameEXP() { mockGl.shown += 1; }, getError: () => 0 };
jest.mock('expo-gl', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    GLView: ({ onContextCreate, style }: { onContextCreate: (gl: unknown) => void; style?: unknown }) => {
      R.useEffect(() => { if (mockSurfaceStarts) onContextCreate(mockGl); }, [onContextCreate]);
      return R.createElement(View, { style, testID: 'mock-gl-view' });
    },
  };
});

jest.mock('three', () => ({ WebGLRenderer: function WebGLRenderer() { /* never constructed: the scene builder is faked */ } }));

interface MockScene { canvas: { getContext: (n: string) => unknown }; log: string[]; disposed: boolean; opts: Record<string, unknown> | undefined }
const mockScenes: MockScene[] = [];
let mockStartThrows = false;
let mockRenderThrows = false;
jest.mock('@/components/livingModel/threeScene', () => ({
  DEFAULT_VIEW: { azimuth: 0.72, elevation: 0.9 },
  createJobScene: (_three: unknown, canvas: MockScene['canvas'], _palette: unknown, opts?: Record<string, unknown>) => {
    if (mockStartThrows) throw new Error('no context');
    const rec: MockScene = { canvas, log: [], disposed: false, opts };
    mockScenes.push(rec);
    return {
      setRooms: (list: unknown[], cut: number | null) => { rec.log.push(`rooms ${list.length} ${cut == null ? 'full' : 'cut'}`); },
      apply: (looks: Map<string, unknown>) => { rec.log.push(`apply ${looks.size}`); },
      resize: (w: number, h: number, pr: number) => { rec.log.push(`resize ${w} ${h} ${pr}`); },
      render: () => { if (mockRenderThrows) throw new Error('lost'); rec.log.push('render'); },
      orbit: () => {}, pan: () => {}, zoomBy: () => {}, turnBy: () => {},
      resetView: () => { rec.log.push('reset'); },
      pick: (x: number, y: number) => { rec.log.push(`pick ${x} ${y}`); return 'kitchen'; },
      project: () => ({ x: 300, y: 150 }),
      roomWidthPx: () => 400, floorHex: () => null, roomCount: () => 0,
      dispose: () => { rec.disposed = true; rec.log.push('dispose'); },
    };
  },
}));

import { JOB_REPLAY_3D_ON_THIS_PLATFORM, JobReplay3D } from '@/components/livingModel/JobReplay3D';
import type { Phone3DEngine } from '@/components/livingModel/phone3d/engine';
import { GLView as MockGLView } from 'expo-gl';
import { createJobScene as mockCreateJobScene } from '@/components/livingModel/threeScene';
import { threeRoomJob } from '@/__tests__/fixtures/livingModelJobs';
import { roomMoment, type RoomMoment } from '@/utils/livingModel/replayCore';

// One frame at a time, by hand: the test says when the screen refreshes.
const frames = new Map<number, (ts: number) => void>();
let nextFrameId = 1;
let clock = 1000;
const realRaf = global.requestAnimationFrame;
const realCancel = global.cancelAnimationFrame;
beforeAll(() => {
  global.requestAnimationFrame = ((cb: (ts: number) => void) => { const id = nextFrameId++; frames.set(id, cb); return id; }) as typeof global.requestAnimationFrame;
  global.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof global.cancelAnimationFrame;
});
afterAll(() => { global.requestAnimationFrame = realRaf; global.cancelAnimationFrame = realCancel; });

const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };
/** Let the screen refresh until nothing asks for another frame (at most `max` times). Returns how many frames ran. */
const refresh = async (max = 8): Promise<number> => {
  let ran = 0;
  for (let i = 0; i < max; i++) {
    const todo = [...frames.values()];
    frames.clear();
    if (!todo.length) break;
    clock += 50;
    await act(async () => { for (const f of todo) f(clock); });
    ran += todo.length;
    await settle();
  }
  return ran;
};

const model = threeRoomJob();
const CLOCK = { totalDays: 50, workingDaysPerWeek: 5, todayOffset: 28, hasStartDate: true };
const momentsAt = (offset: number): Map<string, RoomMoment> => new Map(model.rooms.map((r) => [r.id, roomMoment([], [], offset, CLOCK, 'reported')]));

// jest cannot run a dynamic import, so the engine is handed over the way engine.ts builds it: expo-gl's view and the
// scene builder, both faked above. (That engine.ts reads them lazily, behind the lookup, is held by static read in
// scripts/validate-phone-3d.ts and scripts/validate-living-model.ts.)
const loadEngine = async (): Promise<Phone3DEngine | null> => ({
  GLView: MockGLView as unknown as Phone3DEngine['GLView'],
  createScene: (canvas, palette, opts) => mockCreateJobScene(null as never, canvas as never, palette, opts),
});

let appStateListener: ((s: AppStateStatus) => void) | null = null;

async function mount(over: Partial<React.ComponentProps<typeof JobReplay3D>> = {}) {
  const onSelect = jest.fn();
  const onUnavailable = jest.fn();
  const props = { model, level: 0, moments: momentsAt(10), selectedId: null as string | null, onSelect, onUnavailable, weekLine: 'Week 3 of 10', atToday: false, height: 380, compact: true, loadEngine };
  const view = render(<JobReplay3D {...props} {...over} />);
  await settle();
  // The measured box: 390 by 380 points. The drawing surface is mounted once the box has a size.
  const box = screen.queryByTestId('lm-replay-3d-box');
  if (box) fireEvent(box, 'layout', { nativeEvent: { layout: { width: 390, height: 380, x: 0, y: 0 } } });
  await settle();
  return { view, onSelect, onUnavailable, props };
}

describe('the phone 3D view on a build with the engine', () => {
  beforeEach(() => {
    mockScenes.length = 0;
    mockGl.shown = 0;
    mockStartThrows = false;
    mockRenderThrows = false;
    mockSurfaceStarts = true;
    frames.clear();
    appStateListener = null;
    // The app is in front when the view opens, as it is when a person opens Job Replay.
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, fn: (s: AppStateStatus) => void) => { appStateListener = fn; return { remove: () => { appStateListener = null; } }; }) as never);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('1 mounts the 3D view, builds the scene on the phone context in points at the buffer\'s pixels a point, and shows a frame', async () => {
    expect(JOB_REPLAY_3D_ON_THIS_PLATFORM).toBe(true);
    await mount();
    await refresh();
    expect(screen.getByTestId('lm-replay-3d')).toBeTruthy();
    expect(screen.queryByTestId('lm-flat-replay')).toBeNull();
    expect(mockScenes).toHaveLength(1);
    const s = mockScenes[0];
    expect(s.canvas.getContext('webgl2')).toBe(mockGl);
    expect(s.canvas.getContext('webgl')).toBeNull();
    // A 1170 pixel buffer under a 390 point view: 390 by 380 at 3 pixels a point. Nothing is converted.
    expect(s.log).toContain('resize 390 380 3');
    // The renderer is not asked to smooth (the surface does), and is told it may go past the web's 2 pixels a point.
    expect(s.opts).toMatchObject({ antialias: false, maxPixelRatio: 4 });
    expect(s.log).toContain('rooms 3 cut');
    expect(s.log).toContain('apply 3');
    expect(s.log.filter((l) => l === 'render').length).toBeGreaterThan(0);
    expect(mockGl.shown).toBe(s.log.filter((l) => l === 'render').length);
    expect(screen.getByText('Week 3 of 10')).toBeTruthy();
  });

  it('2 draws nothing again until something changes; a new moment draws one more frame', async () => {
    const { view, props } = await mount();
    await refresh();
    const drawn = mockGl.shown;
    expect(frames.size).toBe(0);
    expect(await refresh()).toBe(0);
    expect(mockGl.shown).toBe(drawn);
    view.rerender(<JobReplay3D {...props} moments={momentsAt(20)} />);
    await settle();
    await refresh();
    expect(mockGl.shown).toBe(drawn + 1);
    expect(frames.size).toBe(0);
  });

  it('3 a room label is ordinary text over the drawing and takes no touch', async () => {
    await mount();
    await refresh();
    // Hidden from a screen reader on purpose (the room list reads each room), so it is asked for by name.
    const pin = screen.getByTestId('lm-pin-kitchen', { includeHiddenElements: true });
    expect(pin.props.pointerEvents).toBe('none');
    expect(pin.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByText('Kitchen', { includeHiddenElements: true })).toBeTruthy();
  });

  it('4 a tap picks the room under the finger, asked of the scene in points', async () => {
    const { onSelect, view, props } = await mount();
    await refresh();
    const touch = screen.getByTestId('lm-replay-3d-touch');
    const bank = (active: boolean) => [{ touchActive: active, startPageX: 120, startPageY: 300, startTimeStamp: 1, currentPageX: 120, currentPageY: 300, currentTimeStamp: 1, previousPageX: 120, previousPageY: 300, previousTimeStamp: 1 }];
    const tap = async () => {
      const t = [{ identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200 }];
      fireEvent(touch, 'responderGrant', { nativeEvent: { touches: t, changedTouches: t, identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200, timestamp: 1 }, touchHistory: { touchBank: bank(true), numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1 } });
      fireEvent(touch, 'responderRelease', { nativeEvent: { touches: [], changedTouches: t, identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200, timestamp: 2 }, touchHistory: { touchBank: bank(false), numberActiveTouches: 0, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 2 } });
      await settle();
    };
    await tap();
    expect(mockScenes[0].log).toContain('pick 100 200');
    expect(onSelect).toHaveBeenLastCalledWith('kitchen');
    view.rerender(<JobReplay3D {...props} selectedId="kitchen" />);
    await settle();
    await tap();
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('5 Cut Away Walls builds the shapes again; Reset View draws one frame', async () => {
    await mount();
    await refresh();
    fireEvent.press(screen.getByTestId('lm-cut'));
    await settle();
    await refresh();
    expect(mockScenes[0].log).toContain('rooms 3 full');
    const drawn = mockGl.shown;
    fireEvent.press(screen.getByTestId('lm-reset-view'));
    await settle();
    await refresh();
    expect(mockScenes[0].log).toContain('reset');
    expect(mockGl.shown).toBe(drawn + 1);
  });

  it('6 leaving gives the scene back', async () => {
    const { view } = await mount();
    await refresh();
    view.unmount();
    expect(mockScenes[0].disposed).toBe(true);
    const drawn = mockGl.shown;
    await refresh();
    expect(mockGl.shown).toBe(drawn);
  });

  it('7 a scene that will not start ends on the flat replay with the plain sentence', async () => {
    mockStartThrows = true;
    const { onUnavailable } = await mount();
    await refresh();
    expect(screen.getByTestId('lm-phone-3d-failed')).toBeTruthy();
    expect(screen.getByText('The 3D view could not start on this phone. The same replay is drawn flat below.')).toBeTruthy();
    expect(screen.getByTestId('lm-flat-replay')).toBeTruthy();
    expect(screen.queryByTestId('lm-replay-3d')).toBeNull();
    expect(screen.queryByTestId('lm-phone-no-engine')).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('8 a frame that throws ends on the flat replay, and the scene is given back once', async () => {
    mockRenderThrows = true;
    await mount();
    await refresh();
    expect(screen.getByTestId('lm-phone-3d-failed')).toBeTruthy();
    expect(screen.getByTestId('lm-flat-replay')).toBeTruthy();
    expect(mockScenes[0].log.filter((l) => l === 'dispose')).toHaveLength(1);
  });

  it('9 the app leaving the front stops the frames; coming back draws one', async () => {
    const { view, props } = await mount();
    await refresh();
    const drawn = mockGl.shown;
    expect(appStateListener).not.toBeNull();
    await act(async () => { appStateListener?.('background'); });
    view.rerender(<JobReplay3D {...props} moments={momentsAt(30)} />);
    await settle();
    await refresh();
    expect(mockGl.shown).toBe(drawn);
    await act(async () => { appStateListener?.('active'); });
    await refresh();
    expect(mockGl.shown).toBe(drawn + 1);
  });

  it('10 Standard on a 3x phone draws a two-thirds surface grown back over the view; High is the whole surface on a new one', async () => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    const { view, props } = await mount();
    await refresh();
    const flatten = (st: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(st) ? st : [st]));
    let surface = flatten(screen.getByTestId('lm-replay-3d-surface').props.style);
    expect(surface.width).toBeCloseTo(260, 6);
    expect(surface.height).toBeCloseTo(380 * 2 / 3, 6);
    expect(surface.transform).toEqual([{ translateX: expect.closeTo(65, 6) }, { translateY: expect.closeTo(380 / 6, 6) }, { scale: expect.closeTo(1.5, 9) }]);
    expect(mockScenes[0].opts).toMatchObject({ shadowMapSize: 1024 });
    view.rerender(<JobReplay3D {...props} quality="high" />);
    await settle();
    fireEvent(screen.getByTestId('lm-replay-3d-box'), 'layout', { nativeEvent: { layout: { width: 390, height: 380, x: 0, y: 0 } } });
    await settle();
    await refresh();
    // A new quality is a new drawing surface: the old scene is given back and a second is built.
    expect(mockScenes).toHaveLength(2);
    expect(mockScenes[0].disposed).toBe(true);
    expect(mockScenes[1].opts).toMatchObject({ shadowMapSize: 2048 });
    surface = flatten(screen.getByTestId('lm-replay-3d-surface').props.style);
    expect(surface.width).toBe(390);
    expect(surface.transform).toEqual([{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  });

  it('11 a finger on the model holds the page; lifting, or leaving with the finger down, gives it back', async () => {
    const onHold = jest.fn();
    const { view } = await mount({ onHold });
    await refresh();
    const touch = screen.getByTestId('lm-replay-3d-touch');
    const t = [{ identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200 }];
    const bank = (active: boolean) => [{ touchActive: active, startPageX: 120, startPageY: 300, startTimeStamp: 1, currentPageX: 120, currentPageY: 300, currentTimeStamp: 1, previousPageX: 120, previousPageY: 300, previousTimeStamp: 1 }];
    const down = () => fireEvent(touch, 'responderGrant', { nativeEvent: { touches: t, changedTouches: t, identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200, timestamp: 1 }, touchHistory: { touchBank: bank(true), numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1 } });
    down();
    expect(onHold.mock.calls).toEqual([[true]]);
    fireEvent(touch, 'responderRelease', { nativeEvent: { touches: [], changedTouches: t, identifier: '1', pageX: 120, pageY: 300, locationX: 100, locationY: 200, timestamp: 2 }, touchHistory: { touchBank: bank(false), numberActiveTouches: 0, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 2 } });
    expect(onHold.mock.calls).toEqual([[true], [false]]);
    down();
    expect(onHold).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onHold).toHaveBeenLastCalledWith(false);
  });

  it('12 the screen is told which is on the glass: 3D, then the flat replay when a frame fails', async () => {
    const onFlat = jest.fn();
    await mount({ onFlat });
    await refresh();
    expect(onFlat).toHaveBeenLastCalledWith(false);
    expect(onFlat).not.toHaveBeenCalledWith(true);
    mockRenderThrows = true;
    fireEvent.press(screen.getByTestId('lm-reset-view'));
    await settle();
    await refresh();
    expect(screen.getByTestId('lm-phone-3d-failed')).toBeTruthy();
    expect(onFlat).toHaveBeenLastCalledWith(true);
  });

  it('13 a drawing surface that never starts ends on the flat replay', async () => {
    jest.useFakeTimers();
    try {
      mockSurfaceStarts = false;
      await mount();
      expect(screen.getByTestId('lm-replay-3d')).toBeTruthy();
      expect(mockScenes).toHaveLength(0);
      await act(async () => { jest.advanceTimersByTime(10001); });
      await settle();
      expect(screen.getByTestId('lm-phone-3d-failed')).toBeTruthy();
      expect(screen.getByTestId('lm-flat-replay')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
