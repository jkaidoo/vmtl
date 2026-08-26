<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SystemControlController extends Controller
{
    /** Setting groups surfaced on the System Controls screen. */
    private const GROUPS = ['features', 'notifications', 'retention', 'maintenance'];

    public function index(): JsonResponse
    {
        $settings = SystemSetting::whereIn('group', self::GROUPS)
            ->orderBy('group')->orderBy('key')
            ->get(['key', 'value', 'type', 'group', 'label']);

        // Cast values for the client (booleans/integers).
        $data = $settings->map(fn (SystemSetting $s) => [
            'key' => $s->key,
            'label' => $s->label,
            'group' => $s->group,
            'type' => $s->type,
            'value' => match ($s->type) {
                'boolean' => filter_var($s->value, FILTER_VALIDATE_BOOLEAN),
                'integer' => (int) $s->value,
                default => $s->value,
            },
        ]);

        return response()->json(['data' => $data]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'settings' => ['required', 'array'],
            'settings.*.key' => ['required', 'string', 'exists:system_settings,key'],
            'settings.*.value' => ['nullable'],
        ]);

        foreach ($validated['settings'] as $item) {
            $existing = SystemSetting::where('key', $item['key'])->whereIn('group', self::GROUPS)->first();
            if (! $existing) {
                continue;
            }
            $value = $existing->type === 'boolean'
                ? (filter_var($item['value'], FILTER_VALIDATE_BOOLEAN) ? '1' : '0')
                : (string) $item['value'];
            SystemSetting::set($item['key'], $value, $existing->type, $existing->group);
        }

        AuditLogger::log('system_controls.updated', "{$request->user()->name} updated system controls");

        return $this->index();
    }
}
