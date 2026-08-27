<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        $userId = $this->route('user')?->id;
        $creating = $userId === null;

        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($userId)],
            'password' => [$creating ? 'required' : 'nullable', 'confirmed', Password::defaults()],
            'role_id' => ['required', 'exists:roles,id'],
            'department_id' => ['nullable', 'exists:departments,id'],
            'org_unit_id' => ['nullable', 'exists:org_units,id'],
            'phone' => ['nullable', 'string', 'max:50'],
            'active' => ['sometimes', 'boolean'],
            // Profile picture as a data URL (client-compressed). ~700KB base64 cap.
            'avatar' => ['nullable', 'string', 'max:700000', 'regex:/^data:image\/(png|jpeg|jpg|webp);base64,/'],
        ];
    }
}
