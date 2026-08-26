<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureCapability
{
    /**
     * Usage: ->middleware('cap:users.manage') or 'cap:analytics.view,reports.export'.
     * Passes when the user holds ANY of the listed capabilities. Enforced
     * server-side, independently of the UI (spec Part II §14).
     */
    public function handle(Request $request, Closure $next, string ...$capabilities): Response
    {
        $user = $request->user();

        if (! $user || ! $user->active) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! empty($capabilities) && ! $user->hasAnyCapability($capabilities)) {
            return response()->json(['message' => 'You do not have the required capability for this action.'], 403);
        }

        return $next($request);
    }
}
