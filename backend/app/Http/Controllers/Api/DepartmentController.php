<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDepartmentRequest;
use App\Http\Resources\DepartmentResource;
use App\Models\Department;
use App\Support\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DepartmentController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Department::class);

        $query = Department::query()
            ->when($request->boolean('active_only'), fn ($q) => $q->where('active', true))
            ->when($request->filled('search'), fn ($q) => $q->where('name', 'like', '%'.$request->string('search').'%'))
            ->orderBy('name');

        if ($request->boolean('all')) {
            return DepartmentResource::collection($query->get());
        }

        return DepartmentResource::collection($query->paginate($request->integer('per_page', 15)));
    }

    public function store(StoreDepartmentRequest $request): JsonResponse
    {
        $this->authorize('create', Department::class);

        $department = Department::create($request->validated());
        AuditLogger::log('department.created', "Department {$department->name} was created", $department);

        return (new DepartmentResource($department))->response()->setStatusCode(201);
    }

    public function update(StoreDepartmentRequest $request, Department $department): DepartmentResource
    {
        $this->authorize('update', $department);

        $department->update($request->validated());
        AuditLogger::log('department.updated', "Department {$department->name} was updated", $department);

        return new DepartmentResource($department->fresh());
    }

    public function destroy(Department $department): JsonResponse
    {
        $this->authorize('delete', $department);

        $department->delete();
        AuditLogger::log('department.deleted', "Department {$department->name} was removed", $department);

        return response()->json(['message' => 'Department removed.']);
    }
}
