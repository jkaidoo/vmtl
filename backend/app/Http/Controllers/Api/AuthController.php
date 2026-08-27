<?php

namespace App\Http\Controllers\Api;

use App\Enums\RoleType;
use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\Role;
use App\Models\User;
use App\Services\DirectoryAuthService;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(LoginRequest $request, DirectoryAuthService $directory): JsonResponse
    {
        $identifier = $request->email;
        $user = User::with(['role', 'department'])->where('email', $identifier)->first();

        // 1) Local password auth first — keeps break-glass + local accounts working.
        $authenticated = $user && Hash::check($request->password, $user->password);

        // 2) Fall back to LDAP/AD when directory auth is enabled and local failed.
        if (! $authenticated) {
            $dir = $directory->authenticate($identifier, $request->password);
            if ($dir) {
                $user = $this->provisionDirectoryUser($dir, $directory);
                $authenticated = (bool) $user;
            }
        }

        if (! $authenticated || ! $user) {
            // Record failed sign-ins for App Health (spec §II-6).
            AuditLogger::log('auth.login_failed', "Failed sign-in for {$identifier}", null, actor: null);

            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (! $user->active) {
            AuditLogger::log('auth.login_blocked', "Blocked sign-in for deactivated account {$user->email}", $user, actor: $user);

            throw ValidationException::withMessages([
                'email' => ['This account has been deactivated.'],
            ]);
        }

        $token = $user->createToken($request->input('device_name', 'web'))->plainTextToken;

        AuditLogger::log('auth.login', "{$user->name} logged in", $user, actor: $user);

        // Resolve the authenticated user so the resource serialises their capabilities.
        $request->setUserResolver(fn () => $user);

        return response()->json([
            'token' => $token,
            'user' => new UserResource($user->load(['role', 'department', 'orgUnit'])),
        ]);
    }

    /**
     * Find or provision the local account for a directory-authenticated user.
     * New accounts are created least-privilege (Staff) with an unusable local
     * password, so they can only ever authenticate through the directory.
     *
     * @param  array{username:string,email:?string,name:string,dn:string,provider:string,groups?:array<int,string>}  $dir
     */
    private function provisionDirectoryUser(array $dir, DirectoryAuthService $directory): ?User
    {
        $email = $dir['email'] ?: $dir['username'];
        if (! $email) {
            return null;
        }

        // Map the user's directory groups to an app role + org unit.
        $groups = $dir['groups'] ?? [];
        $roleSlug = $directory->resolveRole($groups);
        $roleId = Role::where('slug', $roleSlug)->value('id')
            ?? Role::where('slug', RoleType::STAFF->value)->value('id');
        $orgUnitId = $directory->resolveOrgUnit($groups);

        $user = User::where('email', $email)->first();
        if ($user) {
            // Keep role + org unit in sync with directory groups on each login —
            // but never touch the break-glass System Administrator.
            if (! $user->is_super_admin) {
                $changes = [];
                if ($roleId && $user->role_id !== $roleId) {
                    $changes['role_id'] = $roleId;
                }
                if ($orgUnitId && $user->org_unit_id !== $orgUnitId) {
                    $changes['org_unit_id'] = $orgUnitId;
                }
                if ($changes) {
                    $user->update($changes);
                    AuditLogger::log('auth.directory_synced', "Directory role/unit synced for {$email}", $user, actor: $user);
                }
            }

            return $user->load(['role', 'department', 'orgUnit']);
        }

        $user = User::create([
            'name' => $dir['name'] ?: $email,
            'email' => $email,
            'password' => Hash::make(Str::random(48)), // unusable locally — directory only
            'role_id' => $roleId,
            'org_unit_id' => $orgUnitId,
            'active' => true,
        ]);

        AuditLogger::log('auth.directory_provisioned', "Provisioned {$dir['provider']} account {$email} as {$roleSlug}", $user, actor: $user);

        return $user->load(['role', 'department', 'orgUnit']);
    }

    public function me(Request $request): UserResource
    {
        return new UserResource($request->user()->load(['role', 'department', 'orgUnit']));
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    /** Set or clear the authenticated user's own profile picture. */
    public function updateAvatar(Request $request): UserResource
    {
        $data = $request->validate([
            'avatar' => ['nullable', 'string', 'max:700000', 'regex:/^data:image\/(png|jpeg|jpg|webp);base64,/'],
        ]);

        $user = $request->user();
        $user->update(['avatar' => $data['avatar'] ?? null]);
        \App\Support\AuditLogger::log('user.avatar_updated', "{$user->name} updated their profile picture", $user);

        return new UserResource($user->fresh(['role', 'department']));
    }
}
