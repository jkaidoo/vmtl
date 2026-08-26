<?php

namespace Tests\Feature;

use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Models\VehicleRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StaffAccessTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
    }

    private function requestFor($user, string $number): VehicleRequest
    {
        return VehicleRequest::create([
            'request_number' => $number,
            'requester_id' => $user->id,
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0),
            'expected_end_time' => now()->addDay()->setTime(12, 0),
            'destination' => 'X', 'purpose' => 'Y', 'passenger_count' => 1, 'status' => RequestStatus::PENDING,
        ]);
    }

    public function test_staff_has_no_dashboard(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $this->actingAs($staff)->getJson('/api/dashboard')->assertForbidden();
    }

    public function test_staff_only_sees_their_own_requests(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $other = $this->makeUser(RoleType::STAFF);

        $mine = $this->requestFor($staff, 'REQ-MINE');
        $this->requestFor($other, 'REQ-OTHER');

        $response = $this->actingAs($staff)->getJson('/api/vehicle-requests')->assertOk();
        $numbers = collect($response->json('data'))->pluck('request_number');

        $this->assertTrue($numbers->contains('REQ-MINE'));
        $this->assertFalse($numbers->contains('REQ-OTHER'));
        $this->assertCount(1, $numbers);
    }

    public function test_staff_cannot_view_another_users_request(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);
        $other = $this->makeUser(RoleType::STAFF);
        $theirs = $this->requestFor($other, 'REQ-THEIRS');

        $this->actingAs($staff)->getJson("/api/vehicle-requests/{$theirs->id}")->assertForbidden();
    }

    public function test_staff_can_create_and_view_their_own_request(): void
    {
        $staff = $this->makeUser(RoleType::STAFF);

        $create = $this->actingAs($staff)->postJson('/api/vehicle-requests', [
            'travel_date' => now()->addDays(2)->toDateString(),
            'requested_start_time' => now()->addDays(2)->setTime(9, 0)->toIso8601String(),
            'expected_end_time' => now()->addDays(2)->setTime(12, 0)->toIso8601String(),
            'destination' => 'Clinic', 'purpose' => 'Official run', 'passenger_count' => 1,
        ])->assertCreated();

        $id = $create->json('data.id');
        $this->actingAs($staff)->getJson("/api/vehicle-requests/{$id}")->assertOk();
    }
}
