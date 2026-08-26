<?php

namespace Tests;

use App\Enums\RoleType;
use App\Models\Department;
use App\Models\Role;
use App\Models\RoleCapability;
use App\Models\User;
use App\Support\Capabilities;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Hash;

abstract class TestCase extends BaseTestCase
{
    /** Seed the roles (with default capabilities) + a department. */
    protected function seedRolesAndDepartment(): Department
    {
        foreach (RoleType::cases() as $role) {
            Role::updateOrCreate(['slug' => $role->value], ['name' => $role->label()]);
        }

        // Grant each role its default capabilities so policy checks behave.
        foreach (Capabilities::defaultsByRole() as $slug => $caps) {
            $roleId = Role::where('slug', $slug)->value('id');
            foreach ($caps as $cap) {
                RoleCapability::updateOrCreate(['role_id' => $roleId, 'capability' => $cap]);
            }
        }

        return Department::firstOrCreate(['code' => 'TST'], ['name' => 'Test Department']);
    }

    protected function makeUser(RoleType $role, array $attributes = []): User
    {
        $roleModel = Role::where('slug', $role->value)->firstOrFail();

        return User::create(array_merge([
            'name' => $role->label(),
            'email' => $role->value.'_'.uniqid().'@test.local',
            'password' => Hash::make('password'),
            'role_id' => $roleModel->id,
            'active' => true,
        ], $attributes));
    }
}
