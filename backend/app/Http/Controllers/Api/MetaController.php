<?php

namespace App\Http\Controllers\Api;

use App\Enums\DriverStatus;
use App\Enums\MaintenanceType;
use App\Enums\OrgUnitType;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\OrgUnit;
use App\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MetaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        // Org units the user may assign to (their subtree; all for super admin),
        // ordered by tree path with a depth for indented selectors.
        $scope = $request->user()->visibleOrgUnitIds();
        $orgUnits = OrgUnit::query()
            ->where('active', true)
            ->when($scope !== null, fn ($q) => $q->whereIn('id', $scope))
            ->orderBy('path')
            ->get(['id', 'name', 'code', 'type', 'parent_id', 'path'])
            ->map(fn (OrgUnit $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'type' => $u->type->value,
                'type_label' => $u->type->label(),
                'parent_id' => $u->parent_id,
                'depth' => $u->path ? max(0, substr_count($u->path, '/') - 2) : 0,
            ]);

        return response()->json([
            'roles' => Role::orderBy('id')->get(['id', 'slug', 'name']),
            'departments' => Department::where('active', true)->orderBy('name')->get(['id', 'name', 'code']),
            'org_units' => $orgUnits,
            'enums' => [
                'request_status' => RequestStatus::options(),
                'trip_status' => TripStatus::options(),
                'vehicle_status' => VehicleStatus::options(),
                'driver_status' => DriverStatus::options(),
                'role_type' => RoleType::options(),
                'maintenance_type' => MaintenanceType::options(),
                'org_unit_type' => OrgUnitType::options(),
            ],
        ]);
    }
}
