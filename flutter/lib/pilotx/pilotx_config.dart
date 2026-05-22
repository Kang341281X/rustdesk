import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/utils/http_service.dart' as http;
import 'package:flutter_hbb/utils/multi_window_manager.dart';
import 'package:get/get.dart';
import 'package:window_manager/window_manager.dart';

class PilotX {
  static const appName = 'PilotX';
  static const settingsPassword = 'WKANGang429510';
  static const idServer = '121.199.7.66';
  static const relayServer = '121.199.7.66';
  static const serverKey = 'gxljZ40WKnvY80C0zqyc6z7VbiiXagK3SMaV1SlYoJE=';

  static const _role =
      String.fromEnvironment('PILOTX_ROLE', defaultValue: 'controller');
  static const licenseApi = String.fromEnvironment('PILOTX_LICENSE_API',
      defaultValue: 'https://yishengyuzhou.asia/pilotx-admin');
  static const licenseRefreshInterval = Duration(minutes: 30);
  static const licenseStatusCheckInterval = Duration(seconds: 60);

  static bool get isController => _role.toLowerCase() == 'controller';
  static bool get isControlled => _role.toLowerCase() == 'controlled';
  static bool get isPilotX => isController || isControlled;

  static Uri? licenseEndpoint(String action) {
    final safeAction = action == 'refresh'
        ? 'refresh'
        : action == 'status'
            ? 'status'
            : 'activate';
    var base = licenseApi.trim();
    if (base.isEmpty) return null;
    while (base.endsWith('/')) {
      base = base.substring(0, base.length - 1);
    }
    if (base.endsWith('/activate') ||
        base.endsWith('/refresh') ||
        base.endsWith('/status')) {
      base = base.replaceFirst(
        RegExp(r'/(activate|refresh|status)$'),
        '/$safeAction',
      );
    } else if (base.endsWith('/api/licenses')) {
      base = '$base/$safeAction';
    } else if (base.endsWith('/api')) {
      base = '$base/licenses/$safeAction';
    } else {
      base = '$base/api/licenses/$safeAction';
    }
    try {
      return Uri.parse(base);
    } catch (_) {
      return null;
    }
  }

  static Future<void> enforceRuntimeDefaults() async {
    if (!isPilotX) return;
    await bind.mainSetOption(key: 'custom-rendezvous-server', value: idServer);
    await bind.mainSetOption(key: 'relay-server', value: relayServer);
    await bind.mainSetOption(key: 'key', value: serverKey);
    if (isControlled) {
      await bind.mainSetOption(key: kOptionEnableAudio, value: 'N');
    }
    if (isController) {
      await bind.mainSetUserDefaultOption(key: 'view_style', value: 'adaptive');
    }
  }

  static Future<bool> requestSettingsAccess() async {
    if (!isPilotX) return true;
    final context = Get.context;
    if (context == null) return false;

    final controller = TextEditingController();
    var errorText = '';
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return StatefulBuilder(builder: (context, setState) {
          void submit() {
            if (controller.text == settingsPassword) {
              Navigator.of(dialogContext).pop(true);
            } else {
              setState(() => errorText = PilotXText.passwordError);
            }
          }

          return AlertDialog(
            title: const Text(PilotXText.permissionTitle),
            content: TextField(
              controller: controller,
              autofocus: true,
              obscureText: true,
              decoration: InputDecoration(
                labelText: PilotXText.settingsPasswordHint,
                errorText: errorText.isEmpty ? null : errorText,
              ),
              onSubmitted: (_) => submit(),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text(PilotXText.cancel),
              ),
              ElevatedButton(
                onPressed: submit,
                child: const Text(PilotXText.confirm),
              ),
            ],
          );
        });
      },
    );
    controller.dispose();
    return ok == true;
  }
}

class PilotXText {
  static const permissionTitle = '\u6743\u9650\u9a8c\u8bc1';
  static const settingsPasswordHint =
      '\u8bf7\u8f93\u5165\u8bbe\u7f6e\u5bc6\u7801';
  static const passwordError = '\u5bc6\u7801\u9519\u8bef';
  static const cancel = '\u53d6\u6d88';
  static const confirm = '\u786e\u5b9a';
  static const verify = '\u9a8c\u8bc1';
  static const licenseTitle = '\u8bb8\u53ef\u8bc1\u9a8c\u8bc1';
  static const licenseIntro =
      '\u8bf7\u8f93\u5165\u7ba1\u7406\u5458\u4e0b\u53d1\u7684 18 \u4f4d\u8bb8\u53ef\u8bc1\uff0c\u6fc0\u6d3b\u540e\u5c06\u7ed1\u5b9a\u5f53\u524d\u63a7\u5236\u7aef\u3002';
  static const licenseLabel = '\u8bb8\u53ef\u8bc1';
  static const licenseRequired = '\u8bf7\u8f93\u5165\u8bb8\u53ef\u8bc1\u3002';
  static const licenseFailed =
      '\u9a8c\u8bc1\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u54a8\u8be2\u5ba2\u670d\u3002';
  static const licenseExpired =
      '\u8bb8\u53ef\u8bc1\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u54a8\u8be2\u5ba2\u670d\u3002';
  static const licenseInterrupted =
      '\u8bb8\u53ef\u8bc1\u5df2\u8fc7\u671f\uff0c\u5f53\u524d\u64cd\u4f5c\u5df2\u4e2d\u65ad\u3002\u8bf7\u91cd\u65b0\u54a8\u8be2\u5ba2\u670d\u3002';
  static const licenseFormat =
      '\u8bb8\u53ef\u8bc1\u5fc5\u987b\u662f 18 \u4f4d\u5927\u5c0f\u5199\u5b57\u6bcd\u548c\u6570\u5b57\u3002';
  static const licenseServerError =
      '\u8bb8\u53ef\u8bc1\u9a8c\u8bc1\u670d\u52a1\u8fd4\u56de\u5f02\u5e38\u3002';
  static const licenseServerUnavailable =
      '\u65e0\u6cd5\u8fde\u63a5\u8bb8\u53ef\u8bc1\u9a8c\u8bc1\u670d\u52a1\u3002';
  static const licenseInvalid =
      '\u8bb8\u53ef\u8bc1\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u54a8\u8be2\u5ba2\u670d\u3002';
  static const licenseTerminated =
      '\u8bb8\u53ef\u8bc1\u5df2\u5931\u6548\uff0c\u63a7\u5236\u72b6\u6001\u5df2\u9000\u51fa\u3002\u8bf7\u91cd\u65b0\u54a8\u8be2\u5ba2\u670d\u3002';
}

class PilotXLicenseGate extends StatefulWidget {
  final Widget child;

  const PilotXLicenseGate({Key? key, required this.child}) : super(key: key);

  @override
  State<PilotXLicenseGate> createState() => _PilotXLicenseGateState();
}

class _PilotXLicenseGateState extends State<PilotXLicenseGate> {
  Timer? _timer;
  Timer? _statusTimer;
  bool _dialogOpen = false;
  bool _checkingStatus = false;

  @override
  void initState() {
    super.initState();
    if (PilotX.isController) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ensureLicense());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _statusTimer?.cancel();
    super.dispose();
  }

  Future<void> _ensureLicense() async {
    final state = await PilotXLicenseManager.current();
    if (state.isValid) {
      final result = await PilotXLicenseManager.refreshCurrent();
      if (result.ok) {
        _startTimer();
        return;
      }
      if (result.forgetStoredLicense || result.markCodeUsed) {
        await PilotXLicenseManager.clearCurrent(
          markUsed: result.markCodeUsed,
        );
      }
      await _showLicenseDialog(
        result.message ?? PilotXText.licenseInterrupted,
      );
      return;
    }
    if (state.expired) {
      await PilotXLicenseManager.clearCurrent(markUsed: true);
    }
    await _showLicenseDialog(state.expired ? PilotXText.licenseExpired : null);
  }

  void _startTimer() {
    _timer?.cancel();
    _statusTimer?.cancel();
    _timer = Timer.periodic(PilotX.licenseRefreshInterval, (_) async {
      final result = await PilotXLicenseManager.refreshCurrent();
      if (!result.ok) {
        _timer?.cancel();
        _statusTimer?.cancel();
        if (result.forgetStoredLicense || result.markCodeUsed) {
          await PilotXLicenseManager.clearCurrent(
            markUsed: result.markCodeUsed,
          );
        }
        await _interruptAndRevalidate(
          result.message ?? PilotXText.licenseInterrupted,
        );
      }
    });
    _statusTimer = Timer.periodic(
      PilotX.licenseStatusCheckInterval,
      (_) => _checkLicenseStatus(),
    );
  }

  Future<void> _checkLicenseStatus() async {
    if (_checkingStatus || _dialogOpen) return;
    _checkingStatus = true;
    try {
      final result = await PilotXLicenseManager.checkCurrentStatus();
      if (!mounted || result.ok) return;
      if (!result.forgetStoredLicense && !result.markCodeUsed) return;
      _timer?.cancel();
      _statusTimer?.cancel();
      await PilotXLicenseManager.clearCurrent(markUsed: result.markCodeUsed);
      await _interruptAndRevalidate(
        result.message ?? PilotXText.licenseTerminated,
      );
    } finally {
      _checkingStatus = false;
    }
  }

  Future<void> _interruptAndRevalidate(String message) async {
    await rustDeskWinManager.closeAllSubWindows();
    try {
      await windowManager.focus();
    } catch (_) {}
    await _showLicenseDialog(message);
  }

  Future<void> _showLicenseDialog(String? initialError) async {
    if (!mounted || _dialogOpen) return;
    _dialogOpen = true;
    final controller = TextEditingController();
    var errorText = initialError ?? '';
    var verifying = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return StatefulBuilder(builder: (context, setState) {
          Future<void> submit() async {
            final code = controller.text.trim();
            if (code.isEmpty) {
              setState(() => errorText = PilotXText.licenseRequired);
              return;
            }
            setState(() {
              verifying = true;
              errorText = '';
            });
            final result = await PilotXLicenseManager.verifyAndStore(code);
            if (!mounted) return;
            if (result.ok) {
              Navigator.of(dialogContext).pop();
              _startTimer();
            } else {
              setState(() {
                verifying = false;
                errorText = result.message ?? PilotXText.licenseFailed;
              });
            }
          }

          return WillPopScope(
            onWillPop: () async => false,
            child: AlertDialog(
              title: const Text(PilotXText.licenseTitle),
              content: SizedBox(
                width: 420,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(PilotXText.licenseIntro),
                    const SizedBox(height: 12),
                    TextField(
                      controller: controller,
                      autofocus: true,
                      enabled: !verifying,
                      decoration: InputDecoration(
                        labelText: PilotXText.licenseLabel,
                        counterText: '',
                        errorText: errorText.isEmpty ? null : errorText,
                      ),
                      maxLength: 18,
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(
                          RegExp(r'[A-Za-z0-9]'),
                        ),
                      ],
                      onSubmitted: (_) => submit(),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: verifying ? null : _exitApp,
                  child: const Text(PilotXText.cancel),
                ),
                ElevatedButton(
                  onPressed: verifying ? null : submit,
                  child: verifying
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text(PilotXText.verify),
                ),
              ],
            ),
          );
        });
      },
    );
    controller.dispose();
    _dialogOpen = false;
  }

  Future<void> _exitApp() async {
    try {
      await rustDeskWinManager.closeAllSubWindows();
      await windowManager.setPreventClose(false);
      await windowManager.close();
    } catch (_) {
      SystemNavigator.pop();
      if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
        exit(0);
      }
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class PilotXLicenseState {
  final String code;
  final int expiresAt;

  const PilotXLicenseState({required this.code, required this.expiresAt});

  bool get isValid =>
      code.isNotEmpty && expiresAt > DateTime.now().millisecondsSinceEpoch;
  bool get expired =>
      code.isNotEmpty && expiresAt <= DateTime.now().millisecondsSinceEpoch;
}

class PilotXLicenseResult {
  final bool ok;
  final String? message;
  final int? expiresAt;
  final bool markCodeUsed;
  final bool forgetStoredLicense;
  final Map<String, dynamic>? extra;

  const PilotXLicenseResult(
    this.ok, {
    this.message,
    this.expiresAt,
    this.markCodeUsed = false,
    this.forgetStoredLicense = false,
    this.extra,
  });
}

class PilotXLicenseManager {
  static const _schemaKey = 'pilotx_license_schema';
  static const _schemaVersion = 'server-linked-v2';
  static const _apiKey = 'pilotx_license_api';
  static const _codeKey = 'pilotx_license_code';
  static const _expiresAtKey = 'pilotx_license_expires_at';
  static const _activatedAtKey = 'pilotx_license_activated_at';
  static const _durationSecondsKey = 'pilotx_license_duration_seconds';
  static const _lastRefreshAtKey = 'pilotx_license_last_refresh_at';
  static const _usedCodesKey = 'pilotx_license_used_codes';
  static final licenseRevision = 0.obs;

  static Future<PilotXLicenseState> current() async {
    await _ensureServerLinkedSchema();
    final code = bind.mainGetLocalOption(key: _codeKey);
    final expiresAt =
        int.tryParse(bind.mainGetLocalOption(key: _expiresAtKey)) ?? 0;
    return PilotXLicenseState(code: code, expiresAt: expiresAt);
  }

  static Future<void> _ensureServerLinkedSchema() async {
    final schema = bind.mainGetLocalOption(key: _schemaKey);
    final api = bind.mainGetLocalOption(key: _apiKey);
    final currentApi = PilotX.licenseApi.trim();
    if (schema == _schemaVersion && api == currentApi) return;

    await bind.mainSetLocalOption(key: _codeKey, value: '');
    await bind.mainSetLocalOption(key: _expiresAtKey, value: '0');
    await bind.mainSetLocalOption(key: _activatedAtKey, value: '');
    await bind.mainSetLocalOption(key: _durationSecondsKey, value: '0');
    await bind.mainSetLocalOption(key: _lastRefreshAtKey, value: '');
    await bind.mainSetLocalOption(key: _schemaKey, value: _schemaVersion);
    await bind.mainSetLocalOption(key: _apiKey, value: currentApi);
  }

  static Future<void> markCurrentCodeUsed() async {
    final state = await current();
    if (state.code.isEmpty) return;
    final used = _usedCodes();
    if (!used.contains(state.code)) {
      used.add(state.code);
      await bind.mainSetLocalOption(key: _usedCodesKey, value: used.join(','));
      licenseRevision.value++;
    }
  }

  static Future<void> clearCurrent({bool markUsed = false}) async {
    if (markUsed) {
      await markCurrentCodeUsed();
    }
    await bind.mainSetLocalOption(key: _codeKey, value: '');
    await bind.mainSetLocalOption(key: _expiresAtKey, value: '0');
    await bind.mainSetLocalOption(key: _activatedAtKey, value: '');
    await bind.mainSetLocalOption(key: _durationSecondsKey, value: '0');
    await bind.mainSetLocalOption(key: _lastRefreshAtKey, value: '');
    licenseRevision.value++;
  }

  static Future<PilotXLicenseResult> verifyAndStore(String code) async {
    code = code.trim();
    if (!RegExp(r'^[A-Za-z0-9]{18}$').hasMatch(code)) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseFormat,
      );
    }
    if (PilotX.licenseEndpoint('activate') == null) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseServerUnavailable,
      );
    }
    final result = await _verifyOnline(code, 'activate');
    return await _storeIfValid(code, result);
  }

  static Future<PilotXLicenseResult> refreshCurrent() async {
    final state = await current();
    if (state.code.isEmpty) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseRequired,
      );
    }
    if (PilotX.licenseEndpoint('refresh') == null) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseServerUnavailable,
      );
    }
    final result = await _verifyOnline(state.code, 'refresh');
    if (result.ok) {
      return await _storeIfValid(state.code, result);
    }
    return result;
  }

  static Future<PilotXLicenseResult> checkCurrentStatus() async {
    final state = await current();
    if (state.code.isEmpty) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseRequired,
      );
    }
    if (PilotX.licenseEndpoint('status') == null) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseServerUnavailable,
      );
    }
    final result = await _verifyOnline(state.code, 'status');
    if (result.ok) {
      return await _storeIfValid(state.code, result);
    }
    return result;
  }

  static Future<PilotXLicenseResult> _storeIfValid(
    String code,
    PilotXLicenseResult result,
  ) async {
    if (!result.ok || result.expiresAt == null) {
      return result;
    }

    await bind.mainSetLocalOption(key: _codeKey, value: code);
    await bind.mainSetLocalOption(
      key: _expiresAtKey,
      value: result.expiresAt.toString(),
    );
    await bind.mainSetLocalOption(key: _schemaKey, value: _schemaVersion);
    await bind.mainSetLocalOption(
        key: _apiKey, value: PilotX.licenseApi.trim());
    final extra = result.extra ?? const <String, dynamic>{};
    await bind.mainSetLocalOption(
      key: _activatedAtKey,
      value: extra['activated_at']?.toString() ?? '',
    );
    await bind.mainSetLocalOption(
      key: _durationSecondsKey,
      value: extra['duration_seconds']?.toString() ?? '0',
    );
    await bind.mainSetLocalOption(
      key: _lastRefreshAtKey,
      value: DateTime.now().toIso8601String(),
    );
    licenseRevision.value++;
    return result;
  }

  static Future<PilotXLicenseResult> _verifyOnline(
    String code,
    String action,
  ) async {
    final endpoint = PilotX.licenseEndpoint(action);
    if (endpoint == null) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseServerUnavailable,
      );
    }
    try {
      final response = await http.post(
        endpoint,
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({
          'code': code,
          'device_id': await bind.mainGetUuid(),
          'device_name': Platform.localHostname,
          'platform': Platform.operatingSystem,
          'app': PilotX.appName,
          'version': await bind.mainGetVersion(),
        }),
      );
      final data = _decodeResponseBody(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return PilotXLicenseResult(
          false,
          message: data['message']?.toString() ?? PilotXText.licenseServerError,
        );
      }
      if (data['valid'] != true) {
        final status = data['status']?.toString() ?? '';
        return PilotXLicenseResult(
          false,
          message: data['message']?.toString() ?? _messageForStatus(status),
          markCodeUsed: status == 'expired' || status == 'revoked',
          forgetStoredLicense: status == 'expired' ||
              status == 'revoked' ||
              status == 'not_found' ||
              status == 'device_mismatch',
        );
      }
      final expiresAt = _parseExpiresAt(data);
      if (expiresAt == null ||
          expiresAt <= DateTime.now().millisecondsSinceEpoch) {
        return const PilotXLicenseResult(
          false,
          message: PilotXText.licenseExpired,
          markCodeUsed: true,
          forgetStoredLicense: true,
        );
      }
      return PilotXLicenseResult(
        true,
        expiresAt: expiresAt,
        extra: data,
      );
    } catch (_) {
      return const PilotXLicenseResult(
        false,
        message: PilotXText.licenseServerUnavailable,
      );
    }
  }

  static Map<String, dynamic> _decodeResponseBody(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) {
        return decoded.map((key, value) => MapEntry(key.toString(), value));
      }
    } catch (_) {}
    return <String, dynamic>{};
  }

  static String _messageForStatus(String status) {
    switch (status) {
      case 'revoked':
        return '\u8bb8\u53ef\u8bc1\u5df2\u88ab\u7ba1\u7406\u5458\u7ec8\u6b62\u3002';
      case 'expired':
        return PilotXText.licenseExpired;
      case 'device_mismatch':
        return '\u8bb8\u53ef\u8bc1\u5df2\u7ed1\u5b9a\u5176\u4ed6\u63a7\u5236\u7aef\u3002';
      case 'not_found':
        return '\u8bb8\u53ef\u8bc1\u4e0d\u5b58\u5728\u6216\u5df2\u88ab\u5220\u9664\u3002';
      case 'invalid_device':
        return '\u65e0\u6cd5\u8bc6\u522b\u5f53\u524d\u8bbe\u5907\uff0c\u8bb8\u53ef\u8bc1\u6fc0\u6d3b\u5931\u8d25\u3002';
      default:
        return PilotXText.licenseFailed;
    }
  }

  static int? _parseExpiresAt(Map<String, dynamic> data) {
    final raw = data['expires_at'] ?? data['expiresAt'];
    if (raw is int) return raw < 10000000000 ? raw * 1000 : raw;
    if (raw is String) {
      final n = int.tryParse(raw);
      if (n != null) return n < 10000000000 ? n * 1000 : n;
      return DateTime.tryParse(raw)?.millisecondsSinceEpoch;
    }
    final remaining = data['remaining_seconds'] ?? data['duration_seconds'];
    final seconds = remaining is int
        ? remaining
        : remaining is String
            ? int.tryParse(remaining)
            : null;
    if (seconds == null || seconds <= 0) return null;
    return DateTime.now().millisecondsSinceEpoch + seconds * 1000;
  }

  static List<String> _usedCodes() {
    final raw = bind.mainGetLocalOption(key: _usedCodesKey);
    if (raw.trim().isEmpty) return <String>[];
    return raw.split(',').where((e) => e.isNotEmpty).toList();
  }
}
