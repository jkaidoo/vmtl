<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::with(['role', 'department'])->where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            // Record failed sign-ins for App Health (spec §II-6).
            AuditLogger::log('auth.login_failed', "Failed sign-in for {$request->email}", null, actor: null);

            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (! $user->active) {
            AuditLogger::log('auth.login_blocked', "Blocked sign-in for deactivated account {$request->email}", $user, actor: $user);

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
            'user' => new UserResource($user),
        ]);
    }

    public function me(Request $request): UserResource
    {
        return new UserResource($request->user()->load(['role', 'department']));
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
