<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RequestChangesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // policy check runs in the controller
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            // Explanation of what the requester should change (e.g. the booking time).
            'reason' => ['required', 'string', 'min:5', 'max:2000'],
        ];
    }

    /** @return array<string,string> */
    public function messages(): array
    {
        return [
            'reason.required' => 'Explain what the requester needs to change.',
            'reason.min' => 'Please give a clearer explanation of the change needed.',
        ];
    }
}
