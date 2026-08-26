<?php

namespace App\Policies;

use App\Models\User;
use App\Support\Capabilities;

class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasCapability(Capabilities::USERS_MANAGE);
    }

    public function view(User $user, User $model): bool
    {
        return $user->hasCapability(Capabilities::USERS_MANAGE);
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::USERS_MANAGE);
    }

    public function update(User $user, User $model): bool
    {
        // A lesser admin cannot edit the break-glass System Administrator.
        if ($model->isSuperAdmin() && ! $user->isSuperAdmin()) {
            return false;
        }

        return $user->hasCapability(Capabilities::USERS_MANAGE);
    }

    public function delete(User $user, User $model): bool
    {
        if ($model->isSuperAdmin() && ! $user->isSuperAdmin()) {
            return false;
        }

        return $user->hasCapability(Capabilities::USERS_MANAGE) && $user->id !== $model->id;
    }
}
