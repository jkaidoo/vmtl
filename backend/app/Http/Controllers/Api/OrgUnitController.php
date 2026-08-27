<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrgUnitType;
use App\Http\Controllers\Controller;
use App\Models\OrgUnit;
use App\Support\AuditLogger;
use App\Support\Capabilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrgUnitController extends Controller
{
    /** Flat, scoped list for selectors (the units a user may assign to). */
    public function index(Request $request): JsonResponse
    {
        $scope = $request->user()->visibleOrgUnitIds();

        $units = OrgUnit::query()
            ->when($scope !== null, fn ($q) => $q->whereIn('id', $scope))
            ->orderBy('path')
            ->get(['id', 'name', 'code', 'type', 'parent_id', 'path']);

        return response()->json(['data' => $units->map(fn (OrgUnit $u) => $this->row($u))->all()]);
    }

    /** Full hierarchy for the management screen (ordered by path, with depth). */
    public function tree(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasCapability(Capabilities::DEPARTMENTS_MANAGE), 403);

        $units = OrgUnit::withCount(['vehicles', 'drivers', 'users'])->orderBy('path')->get();

        return response()->json([
            'data' => $units->map(fn (OrgUnit $u) => $this->row($u) + [
                'vehicles_count' => $u->vehicles_count,
                'drivers_count' => $u->drivers_count,
                'users_count' => $u->users_count,
                'active' => $u->active,
            ])->all(),
            'types' => OrgUnitType::options(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasCapability(Capabilities::DEPARTMENTS_MANAGE), 403);

        $data = $this->validated($request);
        $unit = OrgUnit::create($data);

        AuditLogger::log('org_unit.created', "Org unit '{$unit->name}' was added", $unit, null, $data);

        return response()->json(['data' => $this->row($unit->fresh())], 201);
    }

    public function update(Request $request, OrgUnit $orgUnit): JsonResponse
    {
        abort_unless($request->user()->hasCapability(Capabilities::DEPARTMENTS_MANAGE), 403);

        $data = $this->validated($request, $orgUnit);
        // Guard against making a unit its own ancestor.
        if (($data['parent_id'] ?? null) && in_array($data['parent_id'], $orgUnit->subtreeIds(), true)) {
            throw new \App\Exceptions\BusinessRuleException('A unit cannot be moved under itself or one of its descendants.');
        }

        $orgUnit->update($data);
        AuditLogger::log('org_unit.updated', "Org unit '{$orgUnit->name}' was updated", $orgUnit, null, $data);

        return response()->json(['data' => $this->row($orgUnit->fresh())]);
    }

    public function destroy(Request $request, OrgUnit $orgUnit): JsonResponse
    {
        abort_unless($request->user()->hasCapability(Capabilities::DEPARTMENTS_MANAGE), 403);

        if ($orgUnit->children()->exists()) {
            throw new \App\Exceptions\BusinessRuleException('Remove or re-parent the sub-units first.');
        }
        if ($orgUnit->vehicles()->exists() || $orgUnit->drivers()->exists() || $orgUnit->users()->exists()) {
            throw new \App\Exceptions\BusinessRuleException('This unit still has vehicles, drivers or staff assigned.');
        }

        $orgUnit->delete();
        AuditLogger::log('org_unit.deleted', "Org unit '{$orgUnit->name}' was removed", $orgUnit);

        return response()->json(['message' => 'Org unit removed.']);
    }

    /** @return array<string,mixed> */
    private function validated(Request $request, ?OrgUnit $unit = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:50'],
            'type' => ['required', 'string', 'in:'.implode(',', array_column(OrgUnitType::cases(), 'value'))],
            'parent_id' => ['nullable', 'exists:org_units,id'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }

    /** @return array<string,mixed> */
    private function row(OrgUnit $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'code' => $u->code,
            'type' => $u->type->value,
            'type_label' => $u->type->label(),
            'parent_id' => $u->parent_id,
            'path' => $u->path,
            'depth' => $u->path ? max(0, substr_count($u->path, '/') - 2) : 0,
        ];
    }
}
