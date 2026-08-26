<?php

namespace Tests\Feature;

use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use App\Notifications\GenericNotification;
use App\Services\AssignmentService;
use App\Services\TripService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class GoodwillAndStopsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
    }

    private function vehicle(): Vehicle
    {
        return Vehicle::create([
            'vehicle_number' => 'UITS-'.uniqid(), 'registration_number' => 'R-'.uniqid(),
            'capacity' => 5, 'current_odometer' => 1000, 'status' => VehicleStatus::AVAILABLE, 'active' => true,
        ]);
    }

    public function test_transport_can_raise_a_goodwill_request_with_explanation(): void
    {
        $this->vehicle();
        $transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);

        $this->actingAs($transport)->postJson('/api/vehicle-requests/goodwill', [
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0)->toIso8601String(),
            'expected_end_time' => now()->addDay()->setTime(11, 0)->toIso8601String(),
            'destination' => 'Community outreach',
            'passenger_count' => 2,
            'goodwill_reason' => 'Support the staff durbar transport.',
        ])->assertCreated()->assertJsonPath('data.is_goodwill', true);
    }

    public function test_goodwill_requires_an_explanation(): void
    {
        $this->vehicle();
        $transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);

        $this->actingAs($transport)->postJson('/api/vehicle-requests/goodwill', [
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0)->toIso8601String(),
            'expected_end_time' => now()->addDay()->setTime(11, 0)->toIso8601String(),
            'destination' => 'X', 'passenger_count' => 1,
        ])->assertStatus(422)->assertJsonValidationErrors('goodwill_reason');
    }

    public function test_staff_cannot_raise_a_goodwill_request(): void
    {
        $this->vehicle();
        $staff = $this->makeUser(RoleType::STAFF);

        $this->actingAs($staff)->postJson('/api/vehicle-requests/goodwill', [
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0)->toIso8601String(),
            'expected_end_time' => now()->addDay()->setTime(11, 0)->toIso8601String(),
            'destination' => 'X', 'passenger_count' => 1, 'goodwill_reason' => 'Please',
        ])->assertForbidden();
    }

    public function test_requester_adds_a_stop_and_driver_acceptance_notifies_the_next_trip(): void
    {
        Notification::fake();

        $transport = $this->makeUser(RoleType::TRANSPORT_ADMIN);
        $staff = $this->makeUser(RoleType::STAFF);
        $vehicle = $this->vehicle();

        // Driver with a login account.
        $driverUser = $this->makeUser(RoleType::DRIVER);
        $driver = Driver::create(['name' => $driverUser->name, 'user_id' => $driverUser->id, 'status' => 'available', 'active' => true]);

        // Current trip (started) for the staff requester.
        $req = VehicleRequest::create([
            'request_number' => 'REQ-A', 'requester_id' => $staff->id,
            'travel_date' => today()->toDateString(),
            'requested_start_time' => now()->subHour(), 'expected_end_time' => now()->addHour(),
            'destination' => 'A', 'purpose' => 'B', 'passenger_count' => 1, 'status' => RequestStatus::APPROVED,
        ]);
        $trip = app(AssignmentService::class)->assign($req, $vehicle->id, $driver->id, $transport);

        // A next scheduled trip for the same vehicle (non-overlapping window).
        $req2 = VehicleRequest::create([
            'request_number' => 'REQ-B', 'requester_id' => $staff->id,
            'travel_date' => today()->toDateString(),
            'requested_start_time' => now()->addHours(2), 'expected_end_time' => now()->addHours(4),
            'destination' => 'C', 'purpose' => 'D', 'passenger_count' => 1, 'status' => RequestStatus::APPROVED,
        ]);
        app(AssignmentService::class)->assign($req2, $vehicle->id, $driver->id, $transport);

        // Now start the current trip.
        app(TripService::class)->start($trip, $transport, 1000);

        // Requester adds a stop.
        $this->actingAs($staff)->postJson("/api/trips/{$trip->id}/stops", ['destination' => 'Detour clinic'])
            ->assertCreated();

        $stopId = $trip->stops()->first()->id;

        // Driver accepts → next trip stakeholders get a delay warning.
        $this->actingAs($driverUser)->postJson("/api/trips/{$trip->id}/stops/{$stopId}/decide", ['accept' => true])
            ->assertOk();

        $this->assertSame('accepted', $trip->stops()->first()->status);

        Notification::assertSentTo($staff, GenericNotification::class, function ($n) {
            return $n->type === 'trip.delay_warning' || $n->type === 'trip.stop_accepted';
        });
    }
}
