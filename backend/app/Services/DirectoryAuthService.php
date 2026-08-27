<?php

namespace App\Services;

use App\Models\SystemSetting;
use Illuminate\Support\Facades\Log;

/**
 * Real LDAP / Active Directory connectivity using the native ext-ldap functions.
 * Reads the per-provider settings saved on the Directory Authentication page and
 * supports a service-account "test connection" plus a full user bind for login.
 */
class DirectoryAuthService
{
    public function extensionLoaded(): bool
    {
        return extension_loaded('ldap');
    }

    public function enabled(): bool
    {
        return (bool) SystemSetting::get('directory_enabled');
    }

    public function provider(): string
    {
        return SystemSetting::get('directory_provider') === 'active_directory' ? 'ad' : 'ldap';
    }

    /**
     * Test connectivity + service bind for a provider.
     *
     * @return array{ok:bool,message:string}
     */
    public function testConnection(string $provider): array
    {
        if (! $this->extensionLoaded()) {
            return ['ok' => false, 'message' => 'The PHP ldap extension is not enabled on the server.'];
        }

        $cfg = $this->config($provider);
        if (empty($cfg['host'])) {
            return ['ok' => false, 'message' => 'No host is configured for this provider.'];
        }

        [$conn, $err] = $this->connect($cfg);
        if (! $conn) {
            return ['ok' => false, 'message' => $err];
        }

        if (empty($cfg['bind_dn'])) {
            @ldap_unbind($conn);

            return ['ok' => true, 'message' => 'Connected to the server (no bind account configured — anonymous).'];
        }

        if (! @ldap_bind($conn, $cfg['bind_dn'], (string) $cfg['bind_password'])) {
            $msg = ldap_error($conn);
            @ldap_unbind($conn);

            return ['ok' => false, 'message' => "Service bind failed: {$msg}."];
        }

        // Confirm the base DN is readable with the service account.
        $baseOk = true;
        if (! empty($cfg['base_dn'])) {
            $baseOk = @ldap_read($conn, $cfg['base_dn'], '(objectclass=*)', ['dn']) !== false;
        }
        @ldap_unbind($conn);

        return $baseOk
            ? ['ok' => true, 'message' => 'Connection and service-account bind succeeded.']
            : ['ok' => true, 'message' => 'Bound successfully, but the Base DN could not be read — check the Base DN.'];
    }

    /**
     * Authenticate a user's credentials against the active directory provider.
     * Returns normalised attributes on success, or null on any failure.
     *
     * @return array{username:string,email:?string,name:string,dn:string,provider:string}|null
     */
    public function authenticate(string $identifier, string $password): ?array
    {
        if (! $this->enabled() || ! $this->extensionLoaded() || $password === '') {
            return null;
        }

        $provider = $this->provider();
        $cfg = $this->config($provider);
        if (empty($cfg['host']) || empty($cfg['base_dn'])) {
            return null;
        }

        try {
            [$conn, $err] = $this->connect($cfg);
            if (! $conn) {
                return null;
            }

            // Bind the service account (if any) to search for the user.
            if (! empty($cfg['bind_dn']) && ! @ldap_bind($conn, $cfg['bind_dn'], (string) $cfg['bind_password'])) {
                @ldap_unbind($conn);

                return null;
            }

            $filter = str_replace('%s', ldap_escape($identifier, '', LDAP_ESCAPE_FILTER), $cfg['user_filter']);
            $attrs = array_values(array_filter([$cfg['attr_username'], $cfg['attr_email'], $cfg['attr_name'], 'memberof']));

            $search = @ldap_search($conn, $cfg['base_dn'], $filter, $attrs);
            if ($search === false) {
                @ldap_unbind($conn);

                return null;
            }

            $entries = ldap_get_entries($conn, $search);
            if (($entries['count'] ?? 0) < 1) {
                @ldap_unbind($conn);

                return null;
            }
            $entry = $entries[0];
            $userDn = $entry['dn'];

            // Verify the user's password by binding as them.
            if (! @ldap_bind($conn, $userDn, $password)) {
                @ldap_unbind($conn);

                return null;
            }

            // Resolve group memberships (AD memberOf, or OpenLDAP member/uniqueMember).
            $groups = $this->resolveGroups($conn, $cfg, $entry, $userDn);

            // Required-group membership gate.
            if (! empty($cfg['required_group_dn'])) {
                $member = false;
                foreach ($groups as $g) {
                    if (strcasecmp(trim($g), trim($cfg['required_group_dn'])) === 0) {
                        $member = true;
                        break;
                    }
                }
                if (! $member) {
                    @ldap_unbind($conn);

                    return null;
                }
            }

            $result = [
                'username' => $this->firstAttr($entry, $cfg['attr_username']) ?? $identifier,
                'email' => $this->firstAttr($entry, $cfg['attr_email']),
                'name' => $this->firstAttr($entry, $cfg['attr_name']) ?? $identifier,
                'dn' => $userDn,
                'provider' => $provider,
                'groups' => $groups,
            ];
            @ldap_unbind($conn);

            return $result;
        } catch (\Throwable $e) {
            Log::warning('Directory authentication error: '.$e->getMessage());

            return null;
        }
    }

    /**
     * The user's group DNs. Prefers the AD-style `memberOf` attribute on the
     * user entry; falls back to searching groups that list the user as a
     * `member` / `uniqueMember` (OpenLDAP-style).
     *
     * @param  \LDAP\Connection|resource  $conn
     * @param  array<string,mixed>  $cfg
     * @param  array<string,mixed>  $entry
     * @return array<int,string>
     */
    private function resolveGroups($conn, array $cfg, array $entry, string $userDn): array
    {
        $groups = $this->attrValues($entry, 'memberof');
        if (! empty($groups)) {
            return $groups;
        }

        $groupBase = $cfg['group_base_dn'] ?: $cfg['base_dn'];
        if (! $groupBase) {
            return [];
        }

        $dn = ldap_escape($userDn, '', LDAP_ESCAPE_FILTER);
        $filter = "(|(member={$dn})(uniqueMember={$dn}))";
        $search = @ldap_search($conn, $groupBase, $filter, ['dn']);
        if ($search === false) {
            return [];
        }

        $entries = ldap_get_entries($conn, $search);
        $out = [];
        for ($i = 0; $i < ($entries['count'] ?? 0); $i++) {
            $out[] = $entries[$i]['dn'];
        }

        return $out;
    }

    /**
     * Map a set of directory group DNs to an app role slug using the configured
     * group→role rules (first match wins, in listed order), else the default role.
     *
     * @param  array<int,string>  $groups
     */
    public function resolveRole(array $groups): string
    {
        $default = SystemSetting::get('directory_default_role') ?: 'staff';
        $rules = SystemSetting::get('directory_role_map');

        if (is_array($rules)) {
            foreach ($rules as $rule) {
                $group = $rule['group'] ?? null;
                $role = $rule['role'] ?? null;
                if (! $group || ! $role) {
                    continue;
                }
                foreach ($groups as $ug) {
                    if (strcasecmp(trim($ug), trim($group)) === 0) {
                        return $role;
                    }
                }
            }
        }

        return $default;
    }

    /**
     * Map directory group DNs to an org-unit id using the same rules (first match
     * with an org unit wins), else the configured default org unit, else null.
     *
     * @param  array<int,string>  $groups
     */
    public function resolveOrgUnit(array $groups): ?int
    {
        $rules = SystemSetting::get('directory_role_map');

        if (is_array($rules)) {
            foreach ($rules as $rule) {
                $group = $rule['group'] ?? null;
                $orgUnitId = $rule['org_unit_id'] ?? null;
                if (! $group || ! $orgUnitId) {
                    continue;
                }
                foreach ($groups as $ug) {
                    if (strcasecmp(trim($ug), trim($group)) === 0) {
                        return (int) $orgUnitId;
                    }
                }
            }
        }

        $default = SystemSetting::get('directory_default_org_unit');

        return $default ? (int) $default : null;
    }

    /**
     * Open an LDAP connection with the configured transport (StartTLS / LDAPS).
     *
     * @param  array<string,mixed>  $cfg
     * @return array{0:\LDAP\Connection|resource|null,1:?string}
     */
    private function connect(array $cfg): array
    {
        $host = preg_replace('#^ldaps?://#i', '', (string) $cfg['host']);
        $scheme = $cfg['ssl'] ? 'ldaps' : 'ldap';
        $port = $cfg['port'] > 0 ? $cfg['port'] : ($cfg['ssl'] ? 636 : 389);
        $uri = "{$scheme}://{$host}:{$port}";

        $conn = @ldap_connect($uri);
        if (! $conn) {
            return [null, 'Could not initialise the LDAP connection (check the host).'];
        }

        ldap_set_option($conn, LDAP_OPT_PROTOCOL_VERSION, 3);
        ldap_set_option($conn, LDAP_OPT_REFERRALS, 0);
        ldap_set_option($conn, LDAP_OPT_NETWORK_TIMEOUT, 5);

        if ($cfg['starttls'] && ! @ldap_start_tls($conn)) {
            $msg = ldap_error($conn);

            return [null, "StartTLS negotiation failed: {$msg}."];
        }

        return [$conn, null];
    }

    /**
     * Resolve a provider's settings into a normalised config array.
     *
     * @return array<string,mixed>
     */
    private function config(string $provider): array
    {
        if ($provider === 'ad') {
            return [
                'host' => SystemSetting::get('ad_host'),
                'port' => (int) SystemSetting::get('ad_port'),
                'ssl' => (bool) SystemSetting::get('ad_use_ssl'),
                'starttls' => false,
                'base_dn' => SystemSetting::get('ad_base_dn'),
                'bind_dn' => SystemSetting::get('ad_bind_account'),
                'bind_password' => SystemSetting::get('ad_bind_password'),
                'user_filter' => SystemSetting::get('ad_user_filter') ?: '(sAMAccountName=%s)',
                'attr_username' => SystemSetting::get('ad_attr_username') ?: 'sAMAccountName',
                'attr_email' => SystemSetting::get('ad_attr_email') ?: 'mail',
                'attr_name' => SystemSetting::get('ad_attr_name') ?: 'displayName',
                'required_group_dn' => SystemSetting::get('ad_required_group_dn'),
                'group_base_dn' => SystemSetting::get('ad_base_dn'),
            ];
        }

        $enc = SystemSetting::get('ldap_encryption') ?: 'none';

        return [
            'host' => SystemSetting::get('ldap_host'),
            'port' => (int) SystemSetting::get('ldap_port'),
            'ssl' => $enc === 'ssl',
            'starttls' => $enc === 'starttls',
            'base_dn' => SystemSetting::get('ldap_base_dn'),
            'bind_dn' => SystemSetting::get('ldap_bind_dn'),
            'bind_password' => SystemSetting::get('ldap_bind_password'),
            'user_filter' => SystemSetting::get('ldap_user_filter') ?: '(uid=%s)',
            'attr_username' => SystemSetting::get('ldap_attr_username') ?: 'uid',
            'attr_email' => SystemSetting::get('ldap_attr_email') ?: 'mail',
            'attr_name' => SystemSetting::get('ldap_attr_name') ?: 'cn',
            'required_group_dn' => SystemSetting::get('ldap_required_group_dn'),
            'group_base_dn' => SystemSetting::get('ldap_group_base_dn'),
        ];
    }

    /** @param array<string,mixed> $entry */
    private function firstAttr(array $entry, ?string $attr): ?string
    {
        if (! $attr) {
            return null;
        }
        $k = strtolower($attr);

        return isset($entry[$k][0]) ? (string) $entry[$k][0] : null;
    }

    /**
     * @param  array<string,mixed>  $entry
     * @return array<int,string>
     */
    private function attrValues(array $entry, string $attr): array
    {
        $k = strtolower($attr);
        if (! isset($entry[$k]) || ! is_array($entry[$k])) {
            return [];
        }
        $vals = $entry[$k];
        unset($vals['count']);

        return array_values($vals);
    }
}
