import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {IconTriangle} from './icons';
import {resolveControlStyle, Theme} from './theme';

/**
 * Static (non-interactive) rendering of one control cluster set, driven
 * by the exact same resolveControlStyle() that the real GameControls
 * uses -- so what the editor/explore screens show is what you actually
 * get in-game, not a separate mockup that can drift out of sync.
 */
export default function ThemePreview({theme}: {theme: Theme}) {
  const s = resolveControlStyle(theme);
  const showXY = theme.system === 'nds';

  return (
    <View style={[styles.shell, {backgroundColor: s.shellBackground, borderColor: s.shellBorder}]}>
      <View style={[styles.screenBezel, {backgroundColor: s.screenBezel}]}>
        <View style={styles.screenPlaceholder} />
      </View>

      <View style={styles.shoulderRow}>
        <View style={[styles.shoulderButton, {backgroundColor: s.shoulderColor, borderRadius: s.shoulderRadius}]}>
          <Text style={styles.shoulderLabel}>L</Text>
        </View>
        <View style={[styles.shoulderButton, {backgroundColor: s.shoulderColor, borderRadius: s.shoulderRadius}]}>
          <Text style={styles.shoulderLabel}>R</Text>
        </View>
      </View>

      {showXY && (
        <View style={styles.systemRow}>
          <View style={[styles.pillButton, {borderRadius: s.actionRadius * 0.6}]}>
            <Text style={styles.pillLabel}>Y</Text>
          </View>
          <View style={[styles.pillButton, {borderRadius: s.actionRadius * 0.6}]}>
            <Text style={styles.pillLabel}>X</Text>
          </View>
        </View>
      )}

      <View style={styles.padRow}>
        <View style={[styles.dpad]}>
          <View style={[styles.dpadBarHorizontal, {backgroundColor: s.dpadColor, borderRadius: s.dpadRadius}]} />
          <View style={[styles.dpadBarVertical, {backgroundColor: s.dpadColor, borderRadius: s.dpadRadius}]} />
          <View style={[styles.dpadHit, styles.dpadHitUp]}>
            <IconTriangle rotation={0} size={12} />
          </View>
          <View style={[styles.dpadHit, styles.dpadHitDown]}>
            <IconTriangle rotation={180} size={12} />
          </View>
          <View style={[styles.dpadHit, styles.dpadHitLeft]}>
            <IconTriangle rotation={-90} size={12} />
          </View>
          <View style={[styles.dpadHit, styles.dpadHitRight]}>
            <IconTriangle rotation={90} size={12} />
          </View>
        </View>

        <View style={styles.actionCluster}>
          <View
            style={[
              styles.actionButton,
              styles.buttonB,
              {backgroundColor: s.actionColorB, borderRadius: s.actionRadius, transform: [{scale: s.actionScale}]},
            ]}>
            <Text style={styles.actionLabel}>B</Text>
          </View>
          <View
            style={[
              styles.actionButton,
              styles.buttonA,
              {backgroundColor: s.actionColorA, borderRadius: s.actionRadius, transform: [{scale: s.actionScale}]},
            ]}>
            <Text style={styles.actionLabel}>A</Text>
          </View>
        </View>
      </View>

      <View style={styles.systemRow}>
        <View style={[styles.pillButton, {borderRadius: s.actionRadius * 0.6}]}>
          <Text style={styles.pillLabel}>SELECT</Text>
        </View>
        <View style={[styles.pillButton, {borderRadius: s.actionRadius * 0.6}]}>
          <Text style={styles.pillLabel}>START</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderWidth: 2,
    borderRadius: 20,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    width: 260,
  },
  screenBezel: {borderRadius: 8, padding: 4, width: '100%'},
  screenPlaceholder: {width: '100%', height: 90, backgroundColor: '#000', borderRadius: 4},
  shoulderRow: {flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 8},
  shoulderButton: {width: 36, height: 26, alignItems: 'center', justifyContent: 'center'},
  shoulderLabel: {color: '#eee', fontWeight: '700', fontSize: 11},
  systemRow: {flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 10},
  pillButton: {
    backgroundColor: '#3a3d47',
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {color: '#ddd', fontSize: 9, fontWeight: '700'},
  padRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: 10},
  dpad: {width: 96, height: 96},
  dpadBarHorizontal: {position: 'absolute', top: 32, left: 0, width: 96, height: 32},
  dpadBarVertical: {position: 'absolute', top: 0, left: 32, width: 32, height: 96},
  dpadHit: {position: 'absolute', width: 32, height: 32, alignItems: 'center', justifyContent: 'center'},
  dpadHitUp: {top: 0, left: 32},
  dpadHitDown: {top: 64, left: 32},
  dpadHitLeft: {top: 32, left: 0},
  dpadHitRight: {top: 32, left: 64},
  actionCluster: {width: 90, height: 70},
  actionButton: {position: 'absolute', width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  buttonA: {top: 0, right: 0},
  buttonB: {bottom: 0, left: 0},
  actionLabel: {color: '#fff', fontSize: 14, fontWeight: '700'},
});
