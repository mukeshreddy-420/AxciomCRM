/**
 * AcxiomCRM Client-Side Scripts & Form Validation
 */

function validateForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', function (e) {
    let valid = true;
    form.querySelectorAll('[data-validate]').forEach(function (input) {
      const rules = input.dataset.validate.split(',');
      const errorEl = document.getElementById(input.name + '-error');
      if (errorEl) errorEl.textContent = '';
      let msg = '';

      rules.forEach(function (rule) {
        if (msg) return;
        const val = input.value.trim();

        if (rule === 'required' && !val) {
          msg = (input.dataset.label || input.name) + ' is required';
        }
        if (rule === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          msg = 'Enter a valid email address';
        }
        if (rule === 'phone' && val && !/^\d{10}$/.test(val)) {
          msg = 'Enter a valid 10-digit phone number';
        }
        if (rule.startsWith('maxlength:')) {
          const max = parseInt(rule.split(':')[1], 10);
          if (val.length > max) {
            msg = (input.dataset.label || input.name) + ' must be at most ' + max + ' characters';
          }
        }
        if (rule === 'positive' && val && (isNaN(val) || parseFloat(val) <= 0)) {
          msg = 'Amount must be greater than 0';
        }
        if (rule === 'probability' && val && (isNaN(val) || parseFloat(val) < 0 || parseFloat(val) > 100)) {
          msg = 'Probability must be between 0 and 100';
        }
        if (rule === 'futuredate' && val) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (new Date(val) < today) {
            msg = 'Date cannot be in the past';
          }
        }
        if (rule === 'password' && val && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(val)) {
          msg = 'Password must be at least 8 characters with uppercase, lowercase, and a digit';
        }
      });

      if (msg) {
        valid = false;
        if (errorEl) errorEl.textContent = msg;
        input.classList.add('is-invalid');
      } else {
        input.classList.remove('is-invalid');
      }
    });

    if (!valid) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

// Auto dismiss alerts after 5 seconds
document.addEventListener('DOMContentLoaded', function () {
  const alerts = document.querySelectorAll('.alert-dismissible');
  alerts.forEach(function (alert) {
    setTimeout(function () {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      if (bsAlert) bsAlert.close();
    }, 5000);
  });
});
