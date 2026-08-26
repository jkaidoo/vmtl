<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    /**
     * Usage: ->middleware('role:administrator,transport_admin')
     * Enforced server-side, independently of any frontend visibility (spec §31).
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user || ! $user->active) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! empty($roles) && ! $user->hasAnyRole($roles)) {
            return response()->json(['message' => 'This action is unauthorized for your role.'], 403);
        }

        return $next($request);
    }
}
