<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Services\DirectoryAuthService;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DirectoryAuthController extends Controller
{
    /**
     * Directory settings grouped for the tabbed UI: a shared "general" group,
     * and independent LDAP and Active Directory configurations. Each provider
     * has its own write-only bind password (see SECRETS).
     *
     * @var array<string, array<string, array{label:string,type:string,options?:array<string,string>}>>
     */
    private const GROUPS = [
        'general' => [
            'directory_enabled' => ['label' => 'Enable directory authentication', 'type' => 'boolean'],
            'directory_provider' => ['label' => 'Active provider', 'type' => 'select', 'options' => [
                'ldap' => 'LDAP',
                'active_directory' => 'Active Directory',
            ]],
        ],
        'ldap' => [
            'ldap_host' => ['label' => 'Host / Server URL', 'type' => 'string'],
            'ldap_port' => ['label' => 'Port', 'type' => 'string'],
            'ldap_encryption' => ['label' => 'Encryption', 'type' => 'select', 'options' => [
                'none' => 'None',
                'starttls' => 'StartTLS',
                'ssl' => 'LDAPS (SSL)',
            ]],
            'ldap_base_dn' => ['label' => 'Base DN', 'type' => 'string'],
            'ldap_bind_dn' => ['label' => 'Bind DN (service account)', 'type' => 'string'],
            'ldap_user_filter' => ['label' => 'User search filter', 'type' => 'string'],
            'ldap_attr_username' => ['label' => 'Username attribute', 'type' => 'string'],
            'ldap_attr_email' => ['label' => 'Email attribute', 'type' => 'string'],
            'ldap_attr_name' => ['label' => 'Display-name attribute', 'type' => 'string'],
            'ldap_group_base_dn' => ['label' => 'Group base DN', 'type' => 'string'],
            'ldap_required_group_dn' => ['label' => 'Required group DN (membership gate)', 'type' => 'string'],
        ],
        'ad' => [
            'ad_domain' => ['label' => 'Domain (FQDN)', 'type' => 'string'],
            'ad_host' => ['label' => 'Domain controller host(s)', 'type' => 'string'],
            'ad_port' => ['label' => 'Port', 'type' => 'string'],
            'ad_use_ssl' => ['label' => 'Use SSL / LDAPS', 'type' => 'boolean'],
            'ad_base_dn' => ['label' => 'Base DN', 'type' => 'string'],
            'ad_bind_account' => ['label' => 'Bind account (user@domain)', 'type' => 'string'],
            'ad_user_filter' => ['label' => 'User search filter', 'type' => 'string'],
            'ad_attr_username' => ['label' => 'Username attribute (sAMAccountName)', 'type' => 'string'],
            'ad_attr_upn' => ['label' => 'UPN attribute (userPrincipalName)', 'type' => 'string'],
            'ad_attr_email' => ['label' => 'Email attribute (mail)', 'type' => 'string'],
            'ad_attr_name' => ['label' => 'Display-name attribute (displayName)', 'type' => 'string'],
            'ad_required_group_dn' => ['label' => 'Required group DN (membership gate)', 'type' => 'string'],
        ],
    ];

    /** Per-provider write-only bind-password setting keys. */
    private const SECRETS = [
        'ldap' => 'ldap_bind_password',
        'ad' => 'ad_bind_password',
    ];

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => [
                'general' => ['fields' => $this->fieldsFor('general')],
                'ldap' => [
                    'fields' => $this->fieldsFor('ldap'),
                    'has_bind_password' => (bool) SystemSetting::get(self::SECRETS['ldap']),
                ],
                'ad' => [
                    'fields' => $this->fieldsFor('ad'),
                    'has_bind_password' => (bool) SystemSetting::get(self::SECRETS['ad']),
                ],
                'mapping' => [
                    'default_role' => SystemSetting::get('directory_default_role') ?: 'staff',
                    'default_org_unit' => SystemSetting::get('directory_default_org_unit') ? (int) SystemSetting::get('directory_default_org_unit') : null,
                    'rules' => is_array(SystemSetting::get('directory_role_map')) ? SystemSetting::get('directory_role_map') : [],
                ],
            ],
        ]);
    }

    /** @return array<int, array<string,mixed>> */
    private function fieldsFor(string $group): array
    {
        $fields = [];
        foreach (self::GROUPS[$group] as $key => $meta) {
            $raw = SystemSetting::get($key);
            $fields[] = [
                'key' => $key,
                'label' => $meta['label'],
                'type' => $meta['type'],
                'options' => $meta['options'] ?? null,
                'value' => $meta['type'] === 'boolean' ? filter_var($raw, FILTER_VALIDATE_BOOLEAN) : ($raw ?? ''),
            ];
        }

        return $fields;
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fields' => ['array'],
            'fields.*.key' => ['required', 'string'],
            'fields.*.value' => ['nullable'],
            // Per-provider secrets — blank means "keep the existing password".
            'ldap_bind_password' => ['nullable', 'string'],
            'ad_bind_password' => ['nullable', 'string'],
            // Group → role / org-unit mapping.
            'default_role' => ['nullable', 'string'],
            'default_org_unit' => ['nullable', 'exists:org_units,id'],
            'role_map' => ['nullable', 'array'],
            'role_map.*.group' => ['required_with:role_map', 'string'],
            'role_map.*.role' => ['required_with:role_map', 'string'],
            'role_map.*.org_unit_id' => ['nullable', 'exists:org_units,id'],
        ]);

        // Flatten the field catalog to look up a key's type/group.
        $catalog = [];
        foreach (self::GROUPS as $group => $keys) {
            foreach ($keys as $key => $meta) {
                $catalog[$key] = ['type' => $meta['type'], 'group' => $group];
            }
        }

        foreach ($data['fields'] ?? [] as $field) {
            $meta = $catalog[$field['key']] ?? null;
            if (! $meta) {
                continue;
            }
            $value = $meta['type'] === 'boolean'
                ? (filter_var($field['value'], FILTER_VALIDATE_BOOLEAN) ? '1' : '0')
                : (string) ($field['value'] ?? '');
            SystemSetting::set($field['key'], $value, $meta['type'] === 'boolean' ? 'boolean' : 'string', 'directory');
        }

        // Only overwrite a secret when a new value is supplied.
        foreach (self::SECRETS as $provider => $secretKey) {
            $input = $data["{$provider}_bind_password"] ?? null;
            if (! empty($input)) {
                SystemSetting::set($secretKey, $input, 'string', 'directory');
            }
        }

        // Group → role / org-unit mapping (only when supplied, so field-only saves don't wipe it).
        if (array_key_exists('default_role', $data)) {
            SystemSetting::set('directory_default_role', $data['default_role'] ?: 'staff', 'string', 'directory');
        }
        if (array_key_exists('default_org_unit', $data)) {
            SystemSetting::set('directory_default_org_unit', $data['default_org_unit'] ?: '', 'string', 'directory');
        }
        if (array_key_exists('role_map', $data)) {
            $rules = array_values(array_map(
                fn ($r) => [
                    'group' => trim((string) $r['group']),
                    'role' => (string) $r['role'],
                    'org_unit_id' => ! empty($r['org_unit_id']) ? (int) $r['org_unit_id'] : null,
                ],
                array_filter($data['role_map'] ?? [], fn ($r) => ! empty($r['group']) && ! empty($r['role'])),
            ));
            SystemSetting::set('directory_role_map', $rules, 'json', 'directory');
        }

        AuditLogger::log('directory_auth.updated', "{$request->user()->name} updated directory authentication settings");

        return $this->index();
    }

    /** Test connectivity + service bind for a provider using the saved settings. */
    public function test(Request $request, DirectoryAuthService $directory): JsonResponse
    {
        $data = $request->validate([
            'provider' => ['required', 'in:ldap,ad'],
        ]);

        $result = $directory->testConnection($data['provider']);

        AuditLogger::log(
            'directory_auth.tested',
            "{$request->user()->name} tested the {$data['provider']} directory connection — ".($result['ok'] ? 'success' : 'failed'),
        );

        return response()->json(['data' => $result]);
    }
}
