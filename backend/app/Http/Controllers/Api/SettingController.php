<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\Driver;
use App\Models\MaintenanceRecord;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\Trip;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    /**
     * The directory-auth group is managed only on the Directory Authentication
     * page — its settings (incl. write-only bind passwords) are never exposed or
     * editable through the generic Settings screen.
     */
    private const PRIVATE_GROUPS = ['directory'];

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => SystemSetting::whereNotIn('group', self::PRIVATE_GROUPS)
                ->orderBy('group')->orderBy('key')->get(['key', 'value', 'type', 'group', 'label']),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'settings' => ['required', 'array'],
            'settings.*.key' => ['required', 'string', 'exists:system_settings,key'],
            'settings.*.value' => ['nullable'],
        ]);

        foreach ($validated['settings'] as $item) {
            $existing = SystemSetting::where('key', $item['key'])->first();
            // Never write private (directory) settings from the generic Settings screen.
            if ($existing && ! in_array($existing->group, self::PRIVATE_GROUPS, true)) {
                SystemSetting::set($item['key'], $item['value'], $existing->type, $existing->group);
            }
        }

        AuditLogger::log('settings.updated', "{$request->user()->name} updated system settings");

        return $this->index();
    }

    /**
     * JSON export of the operational tables (Part II §4). Password hashes and
     * secrets are redacted; the bundled directory is not part of this app.
     */
    public function export(Request $request): JsonResponse
    {
        AuditLogger::log('settings.exported', "{$request->user()->name} exported a data snapshot (JSON)");

        $payload = [
            'meta' => [
                'application' => 'UITS Vehicle Management & Trip Logging',
                'exported_at' => now()->toIso8601String(),
                'exported_by' => $request->user()->email,
            ],
            'roles' => Role::all(['id', 'slug', 'name', 'description']),
            'departments' => Department::all(),
            'users' => User::with('role:id,slug')->get()->map(fn (User $u) => [
                'id' => $u->id, 'name' => $u->name, 'email' => $u->email,
                'role' => $u->role?->slug, 'department_id' => $u->department_id,
                'active' => $u->active, 'password' => '[redacted]',
            ]),
            'vehicles' => Vehicle::all(),
            'drivers' => Driver::all(),
            'vehicle_requests' => VehicleRequest::all(),
            'trips' => Trip::all(),
            'maintenance_records' => MaintenanceRecord::all(),
            'system_settings' => SystemSetting::all(['key', 'value', 'type', 'group', 'label'])->map(function (SystemSetting $s) {
                $secret = str_contains(strtolower($s->key), 'password') || str_contains(strtolower($s->key), 'secret');

                return [
                    'key' => $s->key,
                    'value' => $secret ? '[redacted]' : $s->value,
                    'type' => $s->type,
                    'group' => $s->group,
                    'label' => $s->label,
                ];
            }),
        ];

        $filename = 'uits-vmtl-export_'.now()->format('Ymd_His').'.json';

        return response()->json($payload)
            ->header('Content-Disposition', "attachment; filename=\"{$filename}\"");
    }
}
