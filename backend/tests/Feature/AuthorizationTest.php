<?php

namespace Tests\Feature;

use App\Enums\RoleType;
use App\Models\User;
use App\Models\VehicleRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $staff;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
        $this->staff = $this->makeUser(RoleType::STAFF);
        $this->admin = $this->makeUser(RoleType::ADMINISTRATOR);
    }

    public function test_staff_cannot_view_audit_logs(): void
    {
        $this->actingAs($this->staff)->getJson('/api/audit-logs')->assertForbidden();
    }

    public function test_staff_cannot_list_users(): void
    {
        $this->actingAs($this->staff)->getJson('/api/users')->assertForbidden();
    }

    public function test_admin_can_view_audit_logs(): void
    {
        $this->actingAs($this->admin)->getJson('/api/audit-logs')->assertOk();
    }

    public function test_staff_cannot_approve_requests(): void
    {
        $req = VehicleRequest::create([
            'request_number' => 'REQ-'.uniqid(),
            'requester_id' => $this->makeUser(RoleType::STAFF)->id,
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0),
            'expected_end_time' => now()->addDay()->setTime(12, 0),
            'destination' => 'A', 'purpose' => 'B', 'passenger_count' => 1, 'status' => 'pending',
        ]);

        $this->actingAs($this->staff)->postJson("/api/vehicle-requests/{$req->id}/approve")->assertForbidden();
    }

    public function test_staff_only_sees_their_own_requests(): void
    {
        $other = $this->makeUser(RoleType::STAFF);
        VehicleRequest::create([
            'request_number' => 'REQ-'.uniqid(), 'requester_id' => $other->id,
            'travel_date' => now()->addDay()->toDateString(),
            'requested_start_time' => now()->addDay()->setTime(9, 0),
            'expected_end_time' => now()->addDay()->setTime(12, 0),
            'destination' => 'A', 'purpose' => 'B', 'passenger_count' => 1, 'status' => 'pending',
        ]);

        $this->actingAs($this->staff)->getJson('/api/vehicle-requests')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }
}
