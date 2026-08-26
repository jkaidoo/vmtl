<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSuperAdmin
{
    /**
     * Break-glass tier gate: only the designated System Administrator reaches
     * App Health, RBAC, System Controls, Directory Auth, Database Connections,
     * Documentation and the Codebase Guide (spec Part II §5/§6–§12).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->active) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! $user->isSuperAdmin()) {
            return response()->json(['message' => 'Restricted to the System Administrator.'], 403);
        }

        return $next($request);
    }
}
