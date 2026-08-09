import { z } from 'zod';

const positiveMoney = z
	.number({ message: 'Amount must be a number' })
	.positive('Amount must be positive')
	.refine((value) => Number.isInteger(value * 100), {
		message: 'Amount must have at most 2 decimal places',
	});

const isoDateString = z
	.string()
	.min(1, 'Date is required')
	.refine((value) => !Number.isNaN(Date.parse(value)), {
		message: 'Date must be a valid ISO date',
	});

const monthString = z
	.string()
	.min(1, 'Month is required')
	.refine((value) => /^\d{4}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value)), {
		message: 'Month must be a valid date or YYYY-MM',
	});

export const registerSchema = z.object({
	name: z.string().min(1, 'Name is required'),
	email: z.email('A valid email is required'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
}).strict();

export const loginSchema = z.object({
	email: z.email('A valid email is required'),
	password: z.string().min(1, 'Password is required'),
}).strict();

export const forgotPasswordSchema = z.object({
	email: z.email('A valid email is required'),
}).strict();

export const resetPasswordSchema = z.object({
	token: z.string().min(1, 'Token is required'),
	password: z.string().min(8, 'Password must be at least 8 characters').optional(),
	newPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
}).strict().refine(({ password, newPassword }) => Boolean(password || newPassword), {
	message: 'Password is required',
	path: ['password'],
}).transform(({ token, password, newPassword }) => ({
	token,
	password: password || newPassword,
}));

const profileFieldsSchema = z.object({
	name: z.string().min(1, 'Name must not be empty'),
	email: z.email('A valid email is required'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	phone: z.string().min(1, 'Phone must not be empty'),
	address: z.string().min(1, 'Address must not be empty'),
	preferredCurrency: z.string().min(1, 'Preferred currency must not be empty'),
	themePreference: z.enum(['light', 'dark']),
	budgetResetDay: z.number().int().min(1).max(28),
	dateFormat: z.string().min(1, 'Date format must not be empty'),
}).strict();

export const profileUpdateSchema = profileFieldsSchema.partial();

export const transactionCreateSchema = z.object({
	description: z.string().min(1, 'Description is required').transform((v) => v.trim()).refine((v) => v.length > 0, {
		message: 'Description is required',
	}),
	amount: positiveMoney,
	type: z.enum(['income', 'expense']),
	category_id: z.uuid().optional(),
	date: isoDateString.refine((value) => new Date(value) <= new Date(), {
		message: 'Date cannot be in the future',
	}),
	notes: z.string().optional(),
}).strict();

export const transactionUpdateSchema = transactionCreateSchema.partial().refine(
	(value) => Object.keys(value).length > 0,
	{ message: 'At least one transaction field is required' },
);

export const transactionQuerySchema = z.object({
	type: z.enum(['income', 'expense']).optional(),
	categoryId: z.uuid().optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	minAmount: z.coerce.number().positive().optional(),
	maxAmount: z.coerce.number().positive().optional(),
	search: z.string().min(1).optional(),
}).strict().refine((value) => {
	if (value.from && value.to) {
		return value.to >= value.from;
	}
	return true;
}, {
	message: 'The to date must be on or after the from date',
	path: ['to'],
});

export const budgetSchema = z.object({
	category_id: z.uuid(),
	monthly_limit: z.number().positive(),
	month: monthString,
}).strict();

export const budgetQuerySchema = z.object({
	month: monthString.optional(),
}).strict();

export const categorySchema = z.object({
	name: z.string().min(1, 'Category name is required').max(50, 'Category name cannot exceed 50 characters'),
	type: z.enum(['income', 'expense']),
	color: z.string().min(1).optional(),
}).strict();

const recurringTransactionFields = z.object({
	description: z.string().min(1, 'Description is required').transform((v) => v.trim()).refine((v) => v.length > 0, {
		message: 'Description is required',
	}),
	amount: z.number().positive('Amount must be positive'),
	type: z.enum(['income', 'expense']),
	category_id: z.uuid().optional(),
	frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
	start_date: isoDateString,
	end_date: isoDateString.optional(),
	is_active: z.boolean().optional(),
}).strict();

function endDateAfterStartDate(value) {
	if (!value.end_date) {
		return true;
	}
	return new Date(value.end_date) > new Date(value.start_date);
}

const recurringDateRangeError = {
	message: 'End date must be after start date',
	path: ['end_date'],
};

export const recurringTransactionSchema = recurringTransactionFields.refine(
	endDateAfterStartDate,
	recurringDateRangeError,
);

export const recurringTransactionUpdateSchema = recurringTransactionFields.partial().refine(
	(value) => !value.start_date || endDateAfterStartDate(value),
	recurringDateRangeError,
);

export const alertsQuerySchema = z.object({
	month: monthString.optional(),
}).strict();

export const importCsvBodySchema = z.object({}).strict();
