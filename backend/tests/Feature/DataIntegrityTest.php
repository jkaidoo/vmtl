<?php

namespace Tests\Feature;

use App\Enums\DriverStatus;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Services\AssignmentService;
use App\Services\TripService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DataIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
        $this->transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);
    }

    private function approvedRequest(User $staff): VehicleRequest
    {
        return VehicleRequest::create([
            'request_number' => 'REQ-'.uniqid(),
            'requester_id' => $staff->id,
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0),
            'expected_end_time' => now()->addDay()->setTime(12, 0),
            'destination' => 'A',
            'purpose' => 'B',
            'passenger_count' => 1,
            'status' => RequestStatus::APPROVED,
        ]);
    }

    private function vehicle(): Vehicle
    {
        return Vehicle::create([
            'vehicle_number' => 'UITS-'.uniqid(), 'registration_number' => 'R-'.uniqid(),
            'capacity' => 5, 'current_odometer' => 5000, 'status' => VehicleStatus::AVAILABLE, 'active' => true,
        ]);
    }

    private function driver(): Driver
    {
        return Driver::create(['name' => 'D-'.uniqid(), 'status' => DriverStatus::AVAILABLE, 'active' => true]);
    }

    public function test_overlapping_assignment_is_prevented(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle();
        $driver = $this->driver();
        $service = app(AssignmentService::class);

        $r1 = $this->approvedRequest($staff);
        $service->assign($r1, $vehicle->id, $driver->id, $this->transport);

        // A second, overlapping request for the same vehicle must fail.
        $r2 = $this->approvedRequest($staff);
        $this->expectExceptionMessage('overlapping');
        $service->assign($r2, $vehicle->id, $this->driver()->id, $this->transport);
    }

    public function test_ending_odometer_cannot_be_lower_than_start(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle();
        $driver = $this->driver();

        $trip = app(AssignmentService::class)->assign($this->approvedRequest($staff), $vehicle->id, $driver->id, $this->transport);
        $tripService = app(TripService::class);
        $tripService->start($trip, $this->transport, 5000);

        $this->expectExceptionMessage('cannot be lower');
        $tripService->end($trip->fresh(), $this->transport, 4900);
    }

    public function test_cannot_complete_a_trip_that_has_not_started(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $trip = app(AssignmentService::class)->assign($this->approvedRequest($staff), $this->vehicle()->id, $this->driver()->id, $this->transport);

        $this->expectExceptionMessage('in progress');
        app(TripService::class)->end($trip, $this->transport, 6000);
    }

    public function test_starting_odometer_cannot_be_below_current_reading(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle(); // current 5000
        $trip = app(AssignmentService::class)->assign($this->approvedRequest($staff), $vehicle->id, $this->driver()->id, $this->transport);

        $this->expectExceptionMessage('cannot be lower');
        app(TripService::class)->start($trip, $this->transport, 4000);
    }

    public function test_scheduled_trip_can_be_marked_no_show_and_releases_the_vehicle(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle();
        $driver = $this->driver();
        $request = $this->approvedRequest($staff);

        $trip = app(AssignmentService::class)->assign($request, $vehicle->id, $driver->id, $this->transport);
        $this->assertSame(VehicleStatus::SCHEDULED, $vehicle->fresh()->status);

        $result = app(TripService::class)->markNoShow($trip, $this->transport, 'Requester did not arrive');

        $this->assertSame(TripStatus::NO_SHOW, $result->status);
        $this->assertSame(RequestStatus::NO_SHOW, $request->fresh()->status);
        $this->assertSame(VehicleStatus::AVAILABLE, $vehicle->fresh()->status);
        $this->assertSame(DriverStatus::AVAILABLE, $driver->fresh()->status);
    }

    public function test_completed_trip_cannot_be_marked_no_show(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle();
        $trip = app(AssignmentService::class)->assign($this->approvedRequest($staff), $vehicle->id, $this->driver()->id, $this->transport);
        $service = app(TripService::class);
        $service->start($trip, $this->transport, 5000);
        $service->end($trip->fresh(), $this->transport, 5100);

        $this->expectExceptionMessage('completed trip cannot be marked');
        $service->markNoShow($trip->fresh(), $this->transport);
    }
}
