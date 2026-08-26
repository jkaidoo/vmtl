<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DirectoryAuthController extends Controller
{
    /** Non-secret directory fields (key => label). */
    private const FIELDS = [
        'directory_enabled' => ['label' => 'Enabled', 'type' => 'boolean'],
        'directory_provider' => ['label' => 'Provider', 'type' => 'string'],
        'directory_server_url' => ['label' => 'Server URL', 'type' => 'string'],
        'directory_base_dn' => ['label' => 'Base DN', 'type' => 'string'],
        'directory_bind_dn' => ['label' => 'Bind DN (service account)', 'type' => 'string'],
        'directory_user_filter' => ['label' => 'User search filter', 'type' => 'string'],
        'directory_attr_username' => ['label' => 'Username attribute', 'type' => 'string'],
        'directory_attr_email' => ['label' => 'Email attribute', 'type' => 'string'],
        'directory_attr_name' => ['label' => 'Display-name attribute', 'type' => 'string'],
        'directory_group_base_dn' => ['label' => 'Group base DN', 'type' => 'string'],
        'directory_required_group_dn' => ['label' => 'Required group DN (membership gate)', 'type' => 'string'],
    ];

    private const SECRET_KEY = 'directory_bind_password';

    public function index(): JsonResponse
    {
        $fields = [];
        foreach (self::FIELDS as $key => $meta) {
            $raw = SystemSetting::get($key);
            $fields[] = [
                'key' => $key,
                'label' => $meta['label'],
                'type' => $meta['type'],
                'value' => $meta['type'] === 'boolean' ? filter_var($raw, FILTER_VALIDATE_BOOLEAN) : ($raw ?? ''),
            ];
        }

        return response()->json([
            'data' => [
                'fields' => $fields,
                // The bind password is write-only; we only report whether one is set.
                'has_bind_password' => (bool) SystemSetting::get(self::SECRET_KEY),
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fields' => ['array'],
            'fields.*.key' => ['required', 'string'],
            'fields.*.value' => ['nullable'],
            'bind_password' => ['nullable', 'string'], // "leave blank to keep existing"
        ]);

        foreach ($data['fields'] ?? [] as $field) {
            if (! array_key_exists($field['key'], self::FIELDS)) {
                continue;
            }
            $type = self::FIELDS[$field['key']]['type'];
            $value = $type === 'boolean'
                ? (filter_var($field['value'], FILTER_VALIDATE_BOOLEAN) ? '1' : '0')
                : (string) ($field['value'] ?? '');
            SystemSetting::set($field['key'], $value, $type, 'directory');
        }

        // Only overwrite the secret when a new value is supplied.
        if (! empty($data['bind_password'])) {
            SystemSetting::set(self::SECRET_KEY, $data['bind_password'], 'string', 'directory');
        }

        AuditLogger::log('directory_auth.updated', "{$request->user()->name} updated directory authentication settings");

        return $this->index();
    }
}
