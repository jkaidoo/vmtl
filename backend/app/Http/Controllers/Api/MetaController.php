<?php

namespace App\Http\Controllers\Api;

use App\Enums\DriverStatus;
use App\Enums\MaintenanceType;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\Role;
use Illuminate\Http\JsonResponse;

class MetaController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'roles' => Role::orderBy('id')->get(['id', 'slug', 'name']),
            'departments' => Department::where('active', true)->orderBy('name')->get(['id', 'name', 'code']),
            'enums' => [
                'request_status' => RequestStatus::options(),
                'trip_status' => TripStatus::options(),
                'vehicle_status' => VehicleStatus::options(),
                'driver_status' => DriverStatus::options(),
                'role_type' => RoleType::options(),
                'maintenance_type' => MaintenanceType::options(),
            ],
        ]);
    }
}
