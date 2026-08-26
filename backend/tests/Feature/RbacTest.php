<?php

namespace Tests\Feature;

use App\Enums\RoleType;
use App\Models\Role;
use App\Support\Capabilities;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RbacTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
    }

    public function test_break_glass_pages_require_super_admin(): void
    {
        $admin = $this->makeUser(RoleType::ADMINISTRATOR); // not super
        $this->actingAs($admin)->getJson('/api/admin/app-health')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/rbac')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/admin/system-controls')->assertForbidden();
    }

    public function test_super_admin_can_access_break_glass_pages(): void
    {
        $super = $this->makeUser(RoleType::ADMINISTRATOR, ['is_super_admin' => true]);
        $this->actingAs($super)->getJson('/api/admin/app-health')->assertOk();
        $this->actingAs($super)->getJson('/api/rbac')->assertOk()->assertJsonCount(17, 'data.capabilities');
        $this->actingAs($super)->getJson('/api/admin/database')->assertOk();
        $this->actingAs($super)->getJson('/api/admin/directory-auth')->assertOk();
    }

    public function test_super_admin_can_grant_a_capability_and_it_takes_effect(): void
    {
        $super = $this->makeUser(RoleType::ADMINISTRATOR, ['is_super_admin' => true]);
        $staff = $this->makeUser(RoleType::STAFF);
        $staffRole = Role::where('slug', RoleType::STAFF->value)->first();

        // Staff cannot view analytics initially.
        $this->actingAs($staff)->getJson('/api/analytics')->assertForbidden();

        // Grant the staff role analytics.view + keep requests.create.
        $this->actingAs($super)->putJson("/api/rbac/roles/{$staffRole->id}/capabilities", [
            'capabilities' => [Capabilities::REQUESTS_CREATE, Capabilities::ANALYTICS_VIEW],
        ])->assertOk();

        // Now a fresh staff request can view analytics.
        $this->actingAs($staff->fresh())->getJson('/api/analytics')->assertOk();
    }

    public function test_revoking_a_capability_removes_access(): void
    {
        $super = $this->makeUser(RoleType::ADMINISTRATOR, ['is_super_admin' => true]);
        $approverRole = Role::where('slug', RoleType::APPROVER->value)->first();
        $approver = $this->makeUser(RoleType::APPROVER);

        $this->actingAs($approver)->getJson('/api/analytics')->assertOk();

        // Strip all capabilities from the approver role.
        $this->actingAs($super)->putJson("/api/rbac/roles/{$approverRole->id}/capabilities", ['capabilities' => []])->assertOk();

        $this->actingAs($approver->fresh())->getJson('/api/analytics')->assertForbidden();
    }
}
