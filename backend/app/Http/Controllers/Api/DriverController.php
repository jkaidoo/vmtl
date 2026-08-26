<?php

namespace App\Http\Controllers\Api;

use App\Enums\RoleType;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDriverRequest;
use App\Http\Resources\DriverResource;
use App\Http\Resources\TripResource;
use App\Models\Driver;
use App\Models\Role;
use App\Models\User;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class DriverController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Driver::class);

        $query = Driver::query()
            ->with('user')
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->boolean('active_only'), fn ($q) => $q->where('active', true))
            ->when($request->filled('search'), function ($q) use ($request) {
                $s = $request->string('search');
                $q->where(fn ($qq) => $qq->where('name', 'like', "%{$s}%")
                    ->orWhere('employee_id', 'like', "%{$s}%")
                    ->orWhere('licence_number', 'like', "%{$s}%"));
            })
            ->orderBy('name');

        if ($request->boolean('all')) {
            return DriverResource::collection($query->get());
        }

        return DriverResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreDriverRequest $request): JsonResponse
    {
        $this->authorize('create', Driver::class);

        $driver = DB::transaction(function () use ($request) {
            $driver = Driver::create($request->safe()->except(['create_login', 'login_email', 'login_password']));
            $this->syncLoginAccount($driver, $request);

            return $driver;
        });

        AuditLogger::log('driver.created', "Driver {$driver->name} was added", $driver);

        return (new DriverResource($driver->fresh('user')))->response()->setStatusCode(201);
    }

    public function show(Driver $driver): DriverResource
    {
        $this->authorize('view', $driver);

        return new DriverResource($driver->load('user'));
    }

    public function update(StoreDriverRequest $request, Driver $driver): DriverResource
    {
        $this->authorize('update', $driver);

        $old = $driver->only(['name', 'status', 'active']);
        DB::transaction(function () use ($driver, $request) {
            $driver->update($request->safe()->except(['create_login', 'login_email', 'login_password']));
            $this->syncLoginAccount($driver, $request);
        });

        AuditLogger::log('driver.updated', "Driver {$driver->name} was updated", $driver, $old, $driver->only(['name', 'status', 'active']));

        return new DriverResource($driver->fresh('user'));
    }

    /**
     * Provision or update the driver's self-service login account when requested.
     * Only administrators reach this (create/update are admin-guarded), so a
     * driver account is created with the DRIVER role and linked to the record.
     */
    private function syncLoginAccount(Driver $driver, StoreDriverRequest $request): void
    {
        if (! $request->boolean('create_login')) {
            return;
        }

        $email = $request->input('login_email');
        $password = $request->input('login_password');
        $driverRoleId = Role::where('slug', RoleType::DRIVER->value)->value('id');

        if ($driver->user_id) {
            // Update the existing linked account.
            $user = User::find($driver->user_id);
            if ($user) {
                $user->fill(['name' => $driver->name, 'email' => $email, 'phone' => $driver->phone]);
                if ($password) {
                    $user->password = Hash::make($password);
                }
                $user->save();
            }

            return;
        }

        $user = User::create([
            'name' => $driver->name,
            'email' => $email,
            'password' => Hash::make($password),
            'role_id' => $driverRoleId,
            'phone' => $driver->phone,
            'active' => true,
            'email_verified_at' => now(),
        ]);

        $driver->update(['user_id' => $user->id]);

        AuditLogger::log('driver.account_created', "Login account created for driver {$driver->name} ({$email})", $driver);
    }

    public function destroy(Driver $driver): JsonResponse
    {
        $this->authorize('delete', $driver);

        $driver->delete();
        AuditLogger::log('driver.deleted', "Driver {$driver->name} was removed", $driver);

        return response()->json(['message' => 'Driver removed.']);
    }

    /** Deactivate or reactivate a driver (active flag + status). */
    public function setActive(Request $request, Driver $driver): DriverResource
    {
        $this->authorize('update', $driver);
        $active = $request->boolean('active');

        if (! $active && $driver->status === \App\Enums\DriverStatus::ON_TRIP) {
            throw new \App\Exceptions\BusinessRuleException('This driver is on a trip and cannot be deactivated.');
        }

        $driver->update([
            'active' => $active,
            'status' => $active ? \App\Enums\DriverStatus::AVAILABLE : \App\Enums\DriverStatus::INACTIVE,
        ]);

        AuditLogger::log(
            $active ? 'driver.activated' : 'driver.deactivated',
            "Driver {$driver->name} was ".($active ? 'reactivated' : 'deactivated'),
            $driver,
        );

        return new DriverResource($driver->fresh());
    }

    public function trips(Driver $driver): AnonymousResourceCollection
    {
        $this->authorize('view', $driver);

        return TripResource::collection(
            $driver->trips()->with(['vehicle', 'vehicleRequest.requester', 'vehicleRequest.department'])
                ->orderByDesc('scheduled_start')->paginate(20)
        );
    }
}
