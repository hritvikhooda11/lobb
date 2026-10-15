import * as Device from 'expo-device';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Txt, tap } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const PRODUCT_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

type Mode = 'product' | 'handoff';

const MODES = {
  product: {
    title: 'Scan barcode',
    types: [...PRODUCT_BARCODES],
    hint: 'Line up the barcode inside the box',
    typeHint: 'Type the numbers printed under the barcode instead.',
    placeholder: 'e.g. 028400589895',
    clean: (t: string) => t.replace(/\D/g, '').slice(0, 14),
    valid: (t: string) => t.length >= 8,
    box: { width: 280, height: 160 },
  },
  handoff: {
    title: 'Scan their QR code',
    types: ['qr' as const],
    hint: 'Point at the QR code on their phone',
    typeHint: 'Type the 6-letter code shown under their QR code instead.',
    placeholder: 'e.g. K7Q2PX',
    clean: (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
    valid: (t: string) => t.length === 6,
    box: { width: 240, height: 240 },
  },
};

/**
 * Full-screen scanner for product barcodes or handoff QR codes. Uses the camera on real
 * devices; on the Simulator, web, or without camera permission it falls back to typing.
 */
export function BarcodeScanner({
  visible,
  busy,
  onScanned,
  onClose,
  mode = 'product',
}: {
  visible: boolean;
  busy: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
  mode?: Mode;
}) {
  const config = MODES[mode];
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
    const code = config.clean(data);
    if (busy || !config.valid(code) || lastScan.current === code) return;
    lastScan.current = code;
    tap('success');
    onScanned(code);
  };

  const submitTyped = () => {
    const code = config.clean(typed);
    if (config.valid(code)) onScanned(code);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {useCamera ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: config.types }}
            onBarcodeScanned={busy ? undefined : handleScan}
          />
        ) : null}

        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="heading" style={{ color: '#fff' }}>
            {config.title}
          </Txt>
          <Pressable onPress={onClose} hitSlop={12}>
            <Txt variant="label" style={{ color: '#fff' }}>
              Close
            </Txt>
          </Pressable>
        </View>

        {useCamera ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ ...config.box, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent }} />
            <Txt style={{ color: '#fff', marginTop: space.lg }} center>
              {busy ? 'Checking…' : config.hint}
            </Txt>
            {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.md }} /> : null}
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
            {cameraAvailable === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <View style={{ alignItems: 'center' }}>
                  <Icon name="keypad" size={44} color="#fff" />
                </View>
                <Txt variant="heading" style={{ color: '#fff' }} center>
                  {cameraAvailable && permission && !permission.granted ? 'Camera access is off' : 'No camera here'}
                </Txt>
                <Txt style={{ color: '#bbb' }} center>
                  {config.typeHint}
                </Txt>
                <TextInput
                  value={typed}
                  onChangeText={(t) => setTyped(config.clean(t))}
                  placeholder={config.placeholder}
                  placeholderTextColor="#777"
                  keyboardType={mode === 'product' ? 'number-pad' : 'default'}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={14}
                  onSubmitEditing={submitTyped}
                  style={{ height: 56, borderRadius: radius.md, backgroundColor: '#1c1c1e', color: '#fff', fontSize: 22, letterSpacing: 2, textAlign: 'center' }}
                />
                <Button label={busy ? 'Checking…' : mode === 'product' ? 'Look it up' : 'Confirm code'} kind="accent" disabled={busy || !config.valid(typed)} onPress={submitTyped} />
              </>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
