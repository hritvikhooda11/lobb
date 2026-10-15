import * as Device from 'expo-device';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Txt, tap } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const PRODUCT_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/**
 * Full-screen barcode scanner. Uses the camera on real devices; on the Simulator, web,
 * or without camera permission it falls back to typing the number under the barcode.
 */
export function BarcodeScanner({ visible, busy, onScanned, onClose }: { visible: boolean; busy: boolean; onScanned: (code: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [typed, setTyped] = useState('');
  const lastScan = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    lastScan.current = null;
    setTyped('');
    if (Platform.OS === 'web' || !Device.isDevice) {
      setCameraAvailable(false);
      return;
    }
    CameraView.isAvailableAsync()
      .then(setCameraAvailable)
      .catch(() => setCameraAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (visible && cameraAvailable && permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible, cameraAvailable, permission, requestPermission]);

  const useCamera = cameraAvailable && permission?.granted;

  const handleScan = ({ data }: BarcodeScanningResult) => {
    const code = data.replace(/\D/g, '');
    if (busy || code.length < 8 || lastScan.current === code) return;
    lastScan.current = code;
    tap('success');
    onScanned(code);
  };

  const submitTyped = () => {
    const code = typed.replace(/\D/g, '');
    if (code.length >= 8) onScanned(code);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {useCamera ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...PRODUCT_BARCODES] }}
            onBarcodeScanned={busy ? undefined : handleScan}
          />
        ) : null}

        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="heading" style={{ color: '#fff' }}>
            Scan barcode
          </Txt>
          <Pressable onPress={onClose} hitSlop={12}>
            <Txt variant="label" style={{ color: '#fff' }}>
              Close
            </Txt>
          </Pressable>
        </View>

        {useCamera ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 280, height: 160, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent }} />
            <Txt style={{ color: '#fff', marginTop: space.lg }} center>
              {busy ? 'Looking it up…' : 'Line up the barcode inside the box'}
            </Txt>
            {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.md }} /> : null}
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
            {cameraAvailable === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Txt style={{ fontSize: 48, lineHeight: 56 }} center>
                  🔢
                </Txt>
                <Txt variant="heading" style={{ color: '#fff' }} center>
                  {cameraAvailable && permission && !permission.granted ? 'Camera access is off' : 'No camera here'}
                </Txt>
                <Txt style={{ color: '#bbb' }} center>
                  Type the numbers printed under the barcode instead.
                </Txt>
                <TextInput
                  value={typed}
                  onChangeText={(t) => setTyped(t.replace(/\D/g, ''))}
                  placeholder="e.g. 028400589895"
                  placeholderTextColor="#777"
                  keyboardType="number-pad"
                  maxLength={14}
                  onSubmitEditing={submitTyped}
                  style={{ height: 56, borderRadius: radius.md, backgroundColor: '#1c1c1e', color: '#fff', fontSize: 22, letterSpacing: 2, textAlign: 'center' }}
                />
                <Button label={busy ? 'Looking it up…' : 'Look it up'} kind="accent" disabled={busy || typed.length < 8} onPress={submitTyped} />
              </>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
