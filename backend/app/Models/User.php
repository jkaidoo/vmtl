<?php

namespace App\Models;

use App\Enums\RoleType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $fillable = [
        'name',
        'email',
        'password',
        'role_id',
        'department_id',
        'org_unit_id',
        'phone',
        'active',
        'is_super_admin',
        'avatar',
    ];

    /** @var array<int,string>|null */
    private ?array $capabilityCache = null;

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'active' => 'boolean',
            'is_super_admin' => 'boolean',
        ];
    }

    // ----- Relationships -------------------------------------------------

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function orgUnit(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class);
    }

    /**
     * The org-unit ids this user may see/act on for fleet & drivers.
     * Returns null when the user has unrestricted scope (super admin), otherwise
     * their unit plus all descendants. A user with no unit sees only unassigned
     * (null org_unit) records — represented by an empty id list.
     *
     * @return array<int,int>|null  null = all units
     */
    public function visibleOrgUnitIds(): ?array
    {
        if ($this->is_super_admin) {
            return null;
        }

        return $this->orgUnit ? $this->orgUnit->subtreeIds() : [];
    }

    /**
     * Org-unit ids whose fleet may serve THIS user's requests: their unit plus
     * every ancestor (so a parent/central pool serves sub-units). Null = no
     * restriction (super admin, or a user with no unit — avoids lockout).
     *
     * @return array<int,int>|null
     */
    public function servingOrgUnitIds(): ?array
    {
        if ($this->is_super_admin) {
            return null;
        }

        return $this->orgUnit ? $this->orgUnit->pathIds() : null;
    }

    public function vehicleRequests(): HasMany
    {
        return $this->hasMany(VehicleRequest::class, 'requester_id');
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    /** The driver record this account operates as (for driver self-service). */
    public function driver(): HasOne
    {
        return $this->hasOne(Driver::class);
    }

    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    // ----- Role helpers --------------------------------------------------

    public function roleType(): ?RoleType
    {
        return $this->role ? RoleType::tryFrom($this->role->slug) : null;
    }

    public function hasRole(RoleType|string $role): bool
    {
        $slug = $role instanceof RoleType ? $role->value : $role;

        return $this->role?->slug === $slug;
    }

    /** @param array<int, RoleType|string> $roles */
    public function hasAnyRole(array $roles): bool
    {
        foreach ($roles as $role) {
            if ($this->hasRole($role)) {
                return true;
            }
        }

        return false;
    }

    public function isAdministrator(): bool
    {
        return $this->hasRole(RoleType::ADMINISTRATOR);
    }

    public function isTransportAdmin(): bool
    {
        return $this->hasRole(RoleType::TRANSPORT_ADMIN);
    }

    public function isApprover(): bool
    {
        return $this->hasRole(RoleType::APPROVER);
    }

    public function isStaff(): bool
    {
        return $this->hasRole(RoleType::STAFF);
    }

    public function isDriver(): bool
    {
        return $this->hasRole(RoleType::DRIVER);
    }

    /** Admin and transport officers can manage operational (fleet) resources. */
    public function managesFleet(): bool
    {
        return $this->hasAnyRole([RoleType::ADMINISTRATOR, RoleType::TRANSPORT_ADMIN]);
    }

    // ----- Capability RBAC ----------------------------------------------

    /** The break-glass System Administrator identity (spec Part II §1/§5). */
    public function isSuperAdmin(): bool
    {
        return (bool) $this->is_super_admin;
    }

    /** @return array<int,string> Capability strings granted to this user's role. */
    public function capabilities(): array
    {
        if ($this->capabilityCache !== null) {
            return $this->capabilityCache;
        }

        if (! $this->role_id) {
            return $this->capabilityCache = [];
        }

        return $this->capabilityCache = \App\Models\RoleCapability::where('role_id', $this->role_id)
            ->pluck('capability')
            ->all();
    }

    public function hasCapability(string $capability): bool
    {
        // The super admin implicitly holds every capability.
        return $this->isSuperAdmin() || in_array($capability, $this->capabilities(), true);
    }

    /** @param array<int,string> $capabilities */
    public function hasAnyCapability(array $capabilities): bool
    {
        foreach ($capabilities as $capability) {
            if ($this->hasCapability($capability)) {
                return true;
            }
        }

        return false;
    }

    /**
     * A pure requester (e.g. Staff): may create requests but has no broader
     * visibility — restricted to their own requests only.
     */
    public function isRequesterOnly(): bool
    {
        return ! $this->isSuperAdmin()
            && $this->hasCapability(\App\Support\Capabilities::REQUESTS_CREATE)
            && ! $this->hasCapability(\App\Support\Capabilities::REQUESTS_VIEW_ALL)
            && ! $this->hasCapability(\App\Support\Capabilities::TRIPS_OPERATE)
            && ! $this->hasCapability(\App\Support\Capabilities::ANALYTICS_VIEW);
    }
}
