<?php

namespace App\Http\Requests;

use App\Enums\DriverStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;
use Illuminate\Validation\Rules\Password;

class StoreDriverRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        $driver = $this->route('driver');
        $driverId = $driver?->id;
        $existingUserId = $driver?->user_id;

        // A password is required only when provisioning a brand-new login account.
        $needsPassword = $this->boolean('create_login') && ! $existingUserId;

        return [
            'user_id' => ['nullable', 'exists:users,id'],
            'name' => ['required', 'string', 'max:255'],
            'employee_id' => ['nullable', 'string', 'max:50', Rule::unique('drivers', 'employee_id')->ignore($driverId)],
            'phone' => ['nullable', 'string', 'max:50'],
            'licence_number' => ['nullable', 'string', 'max:100'],
            'licence_expiry' => ['nullable', 'date'],
            'status' => ['sometimes', new Enum(DriverStatus::class)],
            'org_unit_id' => ['nullable', 'exists:org_units,id'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'active' => ['sometimes', 'boolean'],

            // Optional self-service login account for the driver.
            'create_login' => ['sometimes', 'boolean'],
            'login_email' => [
                'nullable',
                'required_if:create_login,true',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($existingUserId),
            ],
            'login_password' => [$needsPassword ? 'required' : 'nullable', 'nullable', Password::defaults()],
        ];
    }
}
