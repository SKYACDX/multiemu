import React, {useCallback, useRef, useState} from 'react';
import {Alert, GestureResponderEvent, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import GbaLinkView, {GbaLinkViewHandle} from './GbaLinkView';
import {IconChevronLeft, IconTriangle} from './icons';
import {InvalidRomExtensionError, pickRomFile, RomPickerCancelledError} from './RomFilePicker';
import {base64ToBytes} from './base64';
import {crc32} from './patchers/crc32';

type PadButton = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'A' | 'B';

interface PickedGba {
  base64: string;
  name: string;
  romId: string;
}

interface Props {
  onClose: () => void;
}

/**
 * Local (same-device) 2-player GBA link cable -- EXPERIMENTAL: first
 * real test of the native lockstep engine (see gba_link.h/.cpp), no
 * audio yet. Deliberately minimal controls (D-pad + A/B only, no L/R/
 * SELECT/START) to fit two full control sets on one phone screen; the
 * full button set can follow once the link protocol itself is
 * confirmed working end-to-end.
 */
export default function LocalLinkScreen({onClose}: Props) {
  const [romA, setRomA] = useState<PickedGba | null>(null);
  const [romB, setRomB] = useState<PickedGba | null>(null);
  const [playing, setPlaying] = useState(false);
  const [picking, setPicking] = useState<'A' | 'B' | null>(null);
  const linkRef = useRef<GbaLinkViewHandle>(null);

  const pick = useCallback(async (slot: 'A' | 'B') => {
    setPicking(slot);
    try {
      const picked = await pickRomFile(['gba']);
      const bytes = base64ToBytes(picked.base64);
      const romId = crc32(bytes).toString(16);
      const entry = {base64: picked.base64, name: picked.name, romId};
      if (slot === 'A') setRomA(entry);
      else setRomB(entry);
    } catch (e) {
      if (e instanceof RomPickerCancelledError) {
        // Nothing to do.
      } else if (e instanceof InvalidRomExtensionError) {
        Alert.alert('Solo GBA por ahora', 'El link cable local solo soporta ROMs de Game Boy Advance.');
      } else {
        Alert.alert('No se pudo cargar la ROM', e instanceof Error ? e.message : String(e));
      }
    } finally {
      setPicking(null);
    }
  }, []);

  const startLink = useCallback(() => {
    if (!romA || !romB) return;
    setPlaying(true);
  }, [romA, romB]);

  const press = (player: 0 | 1, button: PadButton, pressed: boolean) => {
    linkRef.current?.setButtonPressed(player, button, pressed);
  };

  if (playing && romA && romB) {
    return (
      <View style={styles.playContainer}>
        <StatusBar hidden />
        <GbaLinkView
          ref={linkRef}
          style={styles.linkView}
          onLayout={() => {
            linkRef.current?.loadRoms(romA.base64, romA.romId, romB.base64, romB.romId);
          }}
        />
        <View style={styles.controlsRow}>
          <MiniPad player={0} press={press} />
          <Pressable style={styles.exitButton} onPress={onClose}>
            <Text style={styles.exitLabel}>Salir</Text>
          </Pressable>
          <MiniPad player={1} press={press} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <Text style={styles.title}>Link local (2 jugadores)</Text>
      </View>

      <Text style={styles.hint}>
        Experimental -- solo GBA, sin audio todavía. Elige dos ROMs (pueden ser dos copias del mismo juego) para
        conectarlas por cable de enlace en este mismo dispositivo.
      </Text>

      <RomSlot label="Jugador 1" rom={romA} loading={picking === 'A'} onPick={() => pick('A')} />
      <RomSlot label="Jugador 2" rom={romB} loading={picking === 'B'} onPick={() => pick('B')} />

      <Pressable
        style={[styles.startButton, (!romA || !romB) && styles.startButtonDisabled]}
        disabled={!romA || !romB}
        onPress={startLink}>
        <Text style={styles.startLabel}>Conectar y jugar</Text>
      </Pressable>
    </View>
  );
}

function RomSlot({
  label,
  rom,
  loading,
  onPick,
}: {
  label: string;
  rom: PickedGba | null;
  loading: boolean;
  onPick: () => void;
}) {
  return (
    <Pressable style={styles.romSlot} onPress={onPick} disabled={loading}>
      <Text style={styles.romSlotLabel}>{label}</Text>
      <Text style={styles.romSlotValue} numberOfLines={1}>
        {loading ? 'Abriendo…' : rom ? rom.name : 'Toca para elegir una ROM de GBA'}
      </Text>
    </Pressable>
  );
}

/** D-pad + A/B for one player, sharing one touch surface (see App.tsx's GameControls for why that matters). */
type ViewRef = React.ElementRef<typeof View>;

function MiniPad({player, press}: {player: 0 | 1; press: (player: 0 | 1, button: PadButton, pressed: boolean) => void}) {
  const refs = useRef<Partial<Record<PadButton, ViewRef | null>>>({});
  const rects = useRef<Partial<Record<PadButton, {x: number; y: number; w: number; h: number}>>>({});
  const [pressed, setPressed] = useState<Set<PadButton>>(new Set());

  const measureAll = useCallback(() => {
    (Object.keys(refs.current) as PadButton[]).forEach(id => {
      refs.current[id]?.measure((_x: number, _y: number, w: number, h: number, pageX: number, pageY: number) => {
        rects.current[id] = {x: pageX, y: pageY, w, h};
      });
    });
  }, []);

  const setRef = (id: PadButton) => (node: ViewRef | null) => {
    refs.current[id] = node;
  };

  const updateFromTouches = useCallback(
    (evt: GestureResponderEvent) => {
      const touches = evt.nativeEvent.touches.length ? evt.nativeEvent.touches : [evt.nativeEvent];
      const next = new Set<PadButton>();
      for (const touch of touches) {
        for (const id of Object.keys(rects.current) as PadButton[]) {
          const r = rects.current[id];
          if (r && touch.pageX >= r.x && touch.pageX <= r.x + r.w && touch.pageY >= r.y && touch.pageY <= r.y + r.h) {
            next.add(id);
          }
        }
      }
      setPressed(prev => {
        prev.forEach(id => {
          if (!next.has(id)) press(player, id, false);
        });
        next.forEach(id => {
          if (!prev.has(id)) press(player, id, true);
        });
        return next;
      });
    },
    [player, press],
  );

  const releaseAll = useCallback(() => {
    setPressed(prev => {
      prev.forEach(id => press(player, id, false));
      return new Set();
    });
  }, [player, press]);

  const isPressed = (id: PadButton) => pressed.has(id);

  return (
    <View
      style={styles.miniPadArea}
      onLayout={measureAll}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={updateFromTouches}
      onResponderMove={updateFromTouches}
      onResponderRelease={releaseAll}
      onResponderTerminate={releaseAll}>
      <View style={styles.miniDpad}>
        <View style={[styles.miniDpadHit, styles.miniDpadUp, isPressed('UP') && styles.miniHitPressed]} ref={setRef('UP')}>
          <IconTriangle size={12} rotation={0} />
        </View>
        <View style={[styles.miniDpadHit, styles.miniDpadDown, isPressed('DOWN') && styles.miniHitPressed]} ref={setRef('DOWN')}>
          <IconTriangle size={12} rotation={180} />
        </View>
        <View style={[styles.miniDpadHit, styles.miniDpadLeft, isPressed('LEFT') && styles.miniHitPressed]} ref={setRef('LEFT')}>
          <IconTriangle size={12} rotation={-90} />
        </View>
        <View style={[styles.miniDpadHit, styles.miniDpadRight, isPressed('RIGHT') && styles.miniHitPressed]} ref={setRef('RIGHT')}>
          <IconTriangle size={12} rotation={90} />
        </View>
      </View>
      <View style={styles.miniActionCluster}>
        <View style={[styles.miniActionButton, styles.miniButtonB, isPressed('B') && styles.miniHitPressed]} ref={setRef('B')}>
          <Text style={styles.miniActionLabel}>B</Text>
        </View>
        <View style={[styles.miniActionButton, styles.miniButtonA, isPressed('A') && styles.miniHitPressed]} ref={setRef('A')}>
          <Text style={styles.miniActionLabel}>A</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16, paddingHorizontal: 16},
  header: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 17, fontWeight: '700', flexShrink: 1},
  hint: {color: '#888', fontSize: 12, lineHeight: 18, marginBottom: 20},
  romSlot: {backgroundColor: '#1e2027', borderRadius: 12, padding: 14, marginBottom: 12},
  romSlotLabel: {color: '#7ab8ff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4},
  romSlotValue: {color: '#ddd', fontSize: 14},
  startButton: {
    backgroundColor: '#2f5f8f',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  startButtonDisabled: {backgroundColor: '#2a2a2a', opacity: 0.6},
  startLabel: {color: '#fff', fontWeight: '700', fontSize: 15},
  playContainer: {flex: 1, backgroundColor: '#000'},
  linkView: {flex: 1},
  controlsRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exitButton: {backgroundColor: 'rgba(30,32,39,0.85)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14},
  exitLabel: {color: '#ffb3b3', fontSize: 12, fontWeight: '700'},
  miniPadArea: {flexDirection: 'row', alignItems: 'center', gap: 10},
  miniDpad: {width: 84, height: 84},
  miniDpadHit: {
    position: 'absolute',
    width: 28,
    height: 28,
    backgroundColor: 'rgba(40,42,50,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  miniDpadUp: {top: 0, left: 28},
  miniDpadDown: {top: 56, left: 28},
  miniDpadLeft: {top: 28, left: 0},
  miniDpadRight: {top: 28, left: 56},
  miniHitPressed: {backgroundColor: 'rgba(122,184,255,0.5)'},
  miniActionCluster: {width: 70, height: 70},
  miniActionButton: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(140,58,74,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniButtonA: {top: 0, right: 0},
  miniButtonB: {bottom: 0, left: 0},
  miniActionLabel: {color: '#fff', fontWeight: '700', fontSize: 13},
});
