import * as Device from 'expo-device';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton, Txt, tap } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const PRODUCT_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

type Mode = 'product' | 'handoff';

const MODES = {
  product: {
    title: 'Scan barcode',
    types: [...PRODUCT_BARCODES],
    hint: 'Point your camera at the barcode',
    typeHint: 'Type the numbers printed under the barcode.',
    placeholder: 'e.g. 028400589895',
    clean: (t: string) => t.replace(/\D/g, '').slice(0, 14),
    valid: (t: string) => t.length >= 8,
    box: { width: 280, height: 160 },
  },
  handoff: {
    title: 'Scan their QR code',
    types: ['qr' as const],
    hint: 'Point your camera at the QR code on their phone',
    typeHint: 'Type the 6-letter code shown under their QR code.',
    placeholder: 'e.g. K7Q2PX',
    clean: (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
    valid: (t: string) => t.length === 6,
    box: { width: 240, height: 240 },
  },
};

// Real phones always have a camera. (CameraView.isAvailableAsync is web-only and throws on iOS.)
const HAS_CAMERA = Platform.OS !== 'web' && Device.isDevice;

/**
 * Full-screen scanner for product barcodes or handoff QR codes. On a real phone it opens the
 * live camera and reads codes automatically; typing is a fallback (Simulator, web, camera off,
 * or a damaged barcode).
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
  const [manual, setManual] = useState(!HAS_CAMERA);
  const [torch, setTorch] = useState(false);
  const [typed, setTyped] = useState('');
  const lastScan = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    lastScan.current = null;
    setTyped('');
    setTorch(false);
    setManual(!HAS_CAMERA);
  }, [visible]);

  useEffect(() => {
    if (visible && HAS_CAMERA && !manual && permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible, manual, permission, requestPermission]);

  const cameraBlocked = HAS_CAMERA && permission !== null && !permission.granted && !permission.canAskAgain;
  const useCamera = HAS_CAMERA && !manual && !!permission?.granted;

  const handleScan = ({ data }: BarcodeScanningResult) => {
    const code = config.clean(data);
    if (busy || !config.valid(code) || lastScan.current === code) return;
    lastScan.current = code;
    tap('success');
    onScanned(code);
  };

  const submitTyped = () => {
    const code = config.clean(typed);
    if (!config.valid(code)) return;
    Keyboard.dismiss();
    onScanned(code);
  };

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {useCamera ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: config.types }}
            onBarcodeScanned={busy ? undefined : handleScan}
          />
        ) : null}

        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="heading" style={{ color: '#fff' }}>
            {config.title}
          </Txt>
          <Pressable onPress={close} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="close" size={22} color="#fff" />
            <Txt variant="label" style={{ color: '#fff' }}>
              Close
            </Txt>
          </Pressable>
        </View>

        {useCamera ? (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ ...config.box, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent }} />
              <Txt style={{ color: '#fff', marginTop: space.lg, paddingHorizontal: space.xl }} center>
                {busy ? 'Looking it up…' : config.hint}
              </Txt>
              {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.md }} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingBottom: insets.bottom + space.xl }}>
              <IconButton icon={torch ? 'flashlight' : 'flashlight-outline'} size={52} onPress={() => setTorch(!torch)} />
              <Pressable
                onPress={() => setManual(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.pill, paddingHorizontal: space.lg, height: 52 }}>
                <Icon name="keypad-outline" size={18} color="#fff" />
                <Txt variant="label" style={{ color: '#fff' }}>
                  Type it instead
                </Txt>
              </Pressable>
            </View>
          </View>
        ) : HAS_CAMERA && !manual && !cameraBlocked ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          // Tapping anywhere outside the field closes the keyboard.
          <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
              <View style={{ alignItems: 'center' }}>
                <Icon name={cameraBlocked ? 'camera-outline' : 'keypad'} size={44} color="#fff" />
              </View>
              <Txt variant="heading" style={{ color: '#fff' }} center>
                {cameraBlocked ? 'Camera access is off' : 'Type the code'}
              </Txt>
              <Txt style={{ color: '#bbb' }} center>
                {config.typeHint}
              </Txt>
              <TextInput
                value={typed}
                onChangeText={(t) => setTyped(config.clean(t))}
                placeholder={config.placeholder}
                placeholderTextColor="#777"
                // numbers-and-punctuation has a Return key on iOS; number-pad has no way to close.
                keyboardType={mode === 'product' ? 'numbers-and-punctuation' : 'default'}
                returnKeyType="done"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={mode === 'product' ? 14 : 6}
                onSubmitEditing={submitTyped}
                blurOnSubmit
                style={{ height: 56, borderRadius: radius.md, backgroundColor: '#1c1c1e', color: '#fff', fontSize: 22, letterSpacing: 2, textAlign: 'center' }}
              />
              <Button label={busy ? 'Checking…' : mode === 'product' ? 'Look it up' : 'Confirm code'} kind="accent" disabled={busy || !config.valid(typed)} onPress={submitTyped} />
              {cameraBlocked ? (
                <Button label="Turn on camera in Settings" kind="ghost" icon="settings-outline" onPress={() => Linking.openSettings()} />
              ) : HAS_CAMERA ? (
                <Button
                  label="Use the camera"
                  kind="ghost"
                  icon="camera-outline"
                  onPress={() => {
                    Keyboard.dismiss();
                    setManual(false);
                  }}
                />
              ) : null}
            </KeyboardAvoidingView>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}
