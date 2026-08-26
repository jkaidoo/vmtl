<?php

namespace Tests\Feature;

use App\Enums\DriverStatus;
use App\Enums\RoleType;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RequestWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $staff;
    private User $approver;
    private User $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $dept = $this->seedRolesAndDepartment();
        $this->staff = $this->makeUser(RoleType::STAFF, ['department_id' => $dept->id]);
        $this->approver = $this->makeUser(RoleType::APPROVER);
        $this->transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);
    }

    private function vehicle(array $overrides = []): Vehicle
    {
        return Vehicle::create(array_merge([
            'vehicle_number' => 'UITS-'.uniqid(),
            'registration_number' => 'REG-'.uniqid(),
            'capacity' => 5,
            'current_odometer' => 10000,
            'status' => VehicleStatus::AVAILABLE,
            'active' => true,
        ], $overrides));
    }

    private function driver(array $overrides = []): Driver
    {
        return Driver::create(array_merge([
            'name' => 'Driver '.uniqid(),
            'status' => DriverStatus::AVAILABLE,
            'active' => true,
        ], $overrides));
    }

    /** @return array<string,mixed> */
    private function requestPayload(array $overrides = []): array
    {
        return array_merge([
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0)->toDateTimeString(),
            'expected_end_time' => now()->addDay()->setTime(12, 0)->toDateTimeString(),
            'destination' => 'KNUST Hospital',
            'purpose' => 'Official duty',
            'passenger_count' => 2,
        ], $overrides);
    }

    public function test_full_request_lifecycle(): void
    {
        $this->vehicle();
        $this->driver();

        // 1. Staff creates a request.
        $create = $this->actingAs($this->staff)->postJson('/api/vehicle-requests', $this->requestPayload());
        $create->assertCreated();
        $requestId = $create->json('data.id');
        $this->assertSame('pending', $create->json('data.status'));

        // 2. Approver approves.
        $this->actingAs($this->approver)->postJson("/api/vehicle-requests/{$requestId}/approve", ['comment' => 'ok'])
            ->assertOk()->assertJsonPath('data.status', 'approved');

        // 3. Transport officer assigns vehicle + driver.
        $options = $this->actingAs($this->transport)->getJson("/api/vehicle-requests/{$requestId}/assignment-options")->json();
        $assign = $this->actingAs($this->transport)->postJson("/api/vehicle-requests/{$requestId}/assign", [
            'vehicle_id' => $options['vehicles'][0]['id'],
            'driver_id' => $options['drivers'][0]['id'],
        ]);
        $assign->assertCreated()->assertJsonPath('data.status', 'scheduled');
        $tripId = $assign->json('data.id');

        // 4. Start the trip.
        $this->actingAs($this->transport)->postJson("/api/trips/{$tripId}/start", ['starting_odometer' => 10000])
            ->assertOk()->assertJsonPath('data.status', 'in_progress');

        // 5. Complete the trip.
        $complete = $this->actingAs($this->transport)->postJson("/api/trips/{$tripId}/complete", ['ending_odometer' => 10080]);
        $complete->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.distance', 80);

        // Vehicle and driver are released.
        $this->assertSame(VehicleStatus::AVAILABLE, Vehicle::first()->status);
        $this->assertSame(DriverStatus::AVAILABLE, Driver::first()->status);
    }

    public function test_request_validation_rejects_return_before_departure(): void
    {
        $this->actingAs($this->staff)->postJson('/api/vehicle-requests', $this->requestPayload([
            'requested_start_time' => now()->addDay()->setTime(12, 0)->toDateTimeString(),
            'expected_end_time' => now()->addDay()->setTime(9, 0)->toDateTimeString(),
        ]))->assertStatus(422)->assertJsonValidationErrors('expected_end_time');
    }

    public function test_request_validation_requires_passengers(): void
    {
        $this->actingAs($this->staff)->postJson('/api/vehicle-requests', $this->requestPayload(['passenger_count' => 0]))
            ->assertStatus(422)->assertJsonValidationErrors('passenger_count');
    }

    public function test_rejection_requires_a_reason(): void
    {
        $req = $this->actingAs($this->staff)->postJson('/api/vehicle-requests', $this->requestPayload())->json('data.id');

        $this->actingAs($this->approver)->postJson("/api/vehicle-requests/{$req}/reject", [])
            ->assertStatus(422)->assertJsonValidationErrors('reason');

        $this->actingAs($this->approver)->postJson("/api/vehicle-requests/{$req}/reject", ['reason' => 'No vehicle available'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');
    }
}
