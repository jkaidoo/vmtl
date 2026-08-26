<?php

namespace Tests\Feature;

use App\Enums\RoleType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
    }

    public function test_user_can_login_with_valid_credentials(): void
    {
        $user = $this->makeUser(RoleType::ADMINISTRATOR, ['email' => 'admin@test.local']);

        $response = $this->postJson('/api/login', ['email' => 'admin@test.local', 'password' => 'password']);

        $response->assertOk()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'role_slug']]);
        $this->assertSame('administrator', $response->json('user.role_slug'));
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $this->makeUser(RoleType::STAFF, ['email' => 'staff@test.local']);

        $this->postJson('/api/login', ['email' => 'staff@test.local', 'password' => 'wrong'])
            ->assertStatus(422);
    }

    public function test_inactive_user_cannot_login(): void
    {
        $this->makeUser(RoleType::STAFF, ['email' => 'inactive@test.local', 'active' => false]);

        $this->postJson('/api/login', ['email' => 'inactive@test.local', 'password' => 'password'])
            ->assertStatus(422);
    }

    public function test_me_returns_authenticated_user(): void
    {
        $user = $this->makeUser(RoleType::APPROVER);

        $this->actingAs($user)->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('data.role_slug', 'approver');
    }

    public function test_guests_cannot_access_protected_routes(): void
    {
        $this->getJson('/api/dashboard')->assertUnauthorized();
    }
}
