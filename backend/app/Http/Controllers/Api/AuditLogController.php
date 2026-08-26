<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class AuditLogController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        // Audit logs require the audit.view capability (spec §4.4 / §22).
        abort_unless($request->user()->hasCapability(\App\Support\Capabilities::AUDIT_VIEW), 403, 'You may not view the audit log.');

        $query = AuditLog::with('user')
            ->when($request->filled('action'), fn ($q) => $q->where('action', $request->string('action')))
            ->when($request->filled('entity_type'), fn ($q) => $q->where('entity_type', $request->string('entity_type')))
            ->when($request->filled('user_id'), fn ($q) => $q->where('user_id', $request->integer('user_id')))
            ->when($request->filled('date_from'), fn ($q) => $q->whereDate('created_at', '>=', $request->date('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->whereDate('created_at', '<=', $request->date('date_to')))
            ->when($request->filled('search'), fn ($q) => $q->where('description', 'like', '%'.$request->string('search').'%'))
            ->orderByDesc('created_at');

        return AuditLogResource::collection($query->paginate($request->integer('per_page', 25)));
    }
}
