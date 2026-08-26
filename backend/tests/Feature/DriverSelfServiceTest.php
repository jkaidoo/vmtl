<?php

namespace Tests\Feature;

use App\Enums\DriverStatus;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Services\AssignmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DriverSelfServiceTest extends TestCase
{
    use RefreshDatabase;

    private User $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
        $this->transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);
    }

    /** Create a driver with a linked self-service login account. */
    private function driverWithAccount(): Driver
    {
        $user = $this->makeUser(RoleType::DRIVER);

        return Driver::create([
            'name' => $user->name, 'user_id' => $user->id,
            'status' => DriverStatus::AVAILABLE, 'active' => true,
        ]);
    }

    private function scheduledTripFor(Driver $driver)
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = Vehicle::create([
            'vehicle_number' => 'UITS-'.uniqid(), 'registration_number' => 'R-'.uniqid(),
            'capacity' => 5, 'current_odometer' => 1000, 'status' => VehicleStatus::AVAILABLE, 'active' => true,
        ]);
        $request = VehicleRequest::create([
            'request_number' => 'REQ-'.uniqid(), 'requester_id' => $staff->id,
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0),
            'expected_end_time' => now()->addDay()->setTime(12, 0),
            'destination' => 'A', 'purpose' => 'B', 'passenger_count' => 1, 'status' => RequestStatus::APPROVED,
        ]);

        return app(AssignmentService::class)->assign($request, $vehicle->id, $driver->id, $this->transport);
    }

    public function test_driver_can_view_and_operate_their_own_trip(): void
    {
        $driver = $this->driverWithAccount();
        $trip = $this->scheduledTripFor($driver);
        $account = $driver->user;

        // Sees their trip in the list.
        $this->actingAs($account)->getJson('/api/trips')->assertOk()->assertJsonCount(1, 'data');

        // Can start it.
        $this->actingAs($account)->postJson("/api/trips/{$trip->id}/start", ['starting_odometer' => 1000])
            ->assertOk()->assertJsonPath('data.status', 'in_progress');

        // Can complete it.
        $this->actingAs($account)->postJson("/api/trips/{$trip->id}/complete", ['ending_odometer' => 1050])
            ->assertOk()->assertJsonPath('data.status', 'completed');
    }

    public function test_driver_cannot_operate_another_drivers_trip(): void
    {
        $mine = $this->driverWithAccount();
        $other = $this->driverWithAccount();
        $otherTrip = $this->scheduledTripFor($other);

        $this->actingAs($mine->user)->getJson("/api/trips/{$otherTrip->id}")->assertForbidden();
        $this->actingAs($mine->user)->postJson("/api/trips/{$otherTrip->id}/start", ['starting_odometer' => 1000])
            ->assertForbidden();
    }

    public function test_driver_cannot_access_administration(): void
    {
        $driver = $this->driverWithAccount();

        $this->actingAs($driver->user)->getJson('/api/users')->assertForbidden();
        $this->actingAs($driver->user)->getJson('/api/audit-logs')->assertForbidden();
    }

    public function test_admin_can_provision_a_login_for_a_driver(): void
    {
        $admin = $this->makeUser(RoleType::ADMINISTRATOR);

        $response = $this->actingAs($admin)->postJson('/api/drivers', [
            'name' => 'New Driver',
            'create_login' => true,
            'login_email' => 'newdriver@uits.test',
            'login_password' => 'password123',
        ]);

        $response->assertCreated()->assertJsonPath('data.has_account', true);
        $this->assertDatabaseHas('users', ['email' => 'newdriver@uits.test']);

        // The provisioned account can authenticate.
        $this->postJson('/api/login', ['email' => 'newdriver@uits.test', 'password' => 'password123'])
            ->assertOk()->assertJsonPath('user.role_slug', 'driver');
    }
}
