import jsPDF from 'jspdf';

const fmt = (value, currency = 'INR') => {
  const number = Number(value || 0);

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2
    }).format(number);
  } catch {
    return `${currency || 'INR'} ${number.toFixed(2)}`;
  }
};

const safe = value =>
  value === null ||
  value === undefined ||
  value === ''
    ? '—'
    : String(value);

const statusText = value =>
  safe(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char =>
      char.toUpperCase()
    );

export async function downloadSalesInvoicePdf(data) {
  const invoice = data?.invoice || data || {};
  const items = data?.items || [];
  const payments = data?.payments || [];

  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const left = 16;
  const right = pageWidth - 16;

  let y = 17;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(
    safe(invoice.company_name),
    left,
    y
  );

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    'SALES INVOICE',
    right,
    y - 1,
    { align: 'right' }
  );

  y += 8;

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text(
    safe(invoice.invoice_number),
    left,
    y
  );

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 84, 103);
  doc.text(
    statusText(invoice.status),
    right,
    y,
    { align: 'right' }
  );

  y += 7;

  doc.setDrawColor(226, 232, 240);
  doc.line(left, y, right, y);

  y += 9;

  // Invoice metadata / customer
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', left, y);
  doc.text(
    'INVOICE DETAILS',
    122,
    y
  );

  y += 5;

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.text(
    safe(invoice.customer_name),
    left,
    y
  );

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 84, 103);

  doc.text(
    `Invoice date: ${safe(invoice.invoice_date)}`,
    122,
    y
  );

  y += 5;

  if (invoice.customer_email) {
    doc.text(
      String(invoice.customer_email),
      left,
      y
    );
  }

  doc.text(
    `Due date: ${safe(invoice.due_date)}`,
    122,
    y
  );

  y += 5;

  if (invoice.customer_phone) {
    doc.text(
      String(invoice.customer_phone),
      left,
      y
    );
  }

  doc.text(
    `Currency: ${safe(invoice.currency || 'INR')}`,
    122,
    y
  );

  y += 5;

  if (invoice.customer_address) {
    const lines = doc.splitTextToSize(
      String(invoice.customer_address),
      82
    );

    doc.text(lines, left, y);

    y +=
      Math.max(
        lines.length * 4,
        5
      );
  }

  y += 4;

  // Items table
  const colX = {
    item: left,
    description: 58,
    qty: 121,
    rate: 137,
    tax: 162,
    total: right
  };

  doc.setFillColor(248, 250, 252);
  doc.rect(
    left,
    y,
    right - left,
    8,
    'F'
  );

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 84, 103);

  doc.text('ITEM', colX.item, y + 5);
  doc.text(
    'DESCRIPTION',
    colX.description,
    y + 5
  );
  doc.text('QTY', colX.qty, y + 5);
  doc.text('RATE', colX.rate, y + 5);
  doc.text('TAX', colX.tax, y + 5);
  doc.text(
    'TOTAL',
    colX.total,
    y + 5,
    { align: 'right' }
  );

  y += 8;

  doc.setFont('helvetica', 'normal');

  for (const item of items) {
    const itemName =
      doc.splitTextToSize(
        safe(item.item_name),
        38
      );

    const description =
      doc.splitTextToSize(
        safe(item.description),
        54
      );

    const rowLines =
      Math.max(
        itemName.length,
        description.length,
        1
      );

    const rowHeight =
      Math.max(
        9,
        rowLines * 4 + 3
      );

    if (y + rowHeight > 270) {
      doc.addPage();
      y = 18;
    }

    doc.setTextColor(
      52,
      64,
      84
    );
    doc.setFontSize(8);

    doc.text(
      itemName,
      colX.item,
      y + 5
    );

    doc.text(
      description,
      colX.description,
      y + 5
    );

    doc.text(
      safe(item.quantity),
      colX.qty,
      y + 5
    );

    doc.text(
      fmt(
        item.unit_price,
        invoice.currency
      ),
      colX.rate,
      y + 5
    );

    doc.text(
      `${Number(item.tax_rate || 0)}%`,
      colX.tax,
      y + 5
    );

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.text(
      fmt(
        item.line_total,
        invoice.currency
      ),
      colX.total,
      y + 5,
      { align: 'right' }
    );

    doc.setFont(
      'helvetica',
      'normal'
    );

    y += rowHeight;

    doc.setDrawColor(
      241,
      245,
      249
    );
    doc.line(
      left,
      y,
      right,
      y
    );
  }

  y += 8;

  // Totals
  const labelX = 136;

  const totalRow = (
    label,
    value,
    bold = false
  ) => {
    if (bold) {
      doc.setFont(
        'helvetica',
        'bold'
      );
      doc.setFontSize(10.5);
      doc.setTextColor(
        17,
        24,
        39
      );
    } else {
      doc.setFont(
        'helvetica',
        'normal'
      );
      doc.setFontSize(8.5);
      doc.setTextColor(
        71,
        84,
        103
      );
    }

    doc.text(label, labelX, y);

    doc.text(
      fmt(
        value,
        invoice.currency
      ),
      right,
      y,
      { align: 'right' }
    );

    y += bold ? 7 : 5.5;
  };

  totalRow(
    'Subtotal',
    invoice.subtotal
  );

  totalRow(
    'Tax',
    invoice.tax_amount
  );

  totalRow(
    'Discount',
    invoice.discount_amount
  );

  doc.setDrawColor(
    203,
    213,
    225
  );

  doc.line(
    labelX,
    y - 2,
    right,
    y - 2
  );

  y += 2;

  totalRow(
    'Total',
    invoice.total_amount,
    true
  );

  totalRow(
    'Paid',
    invoice.paid_amount
  );

  totalRow(
    'Balance',
    invoice.balance_amount,
    true
  );

  y += 4;

  // Notes / terms
  if (
    invoice.notes ||
    invoice.terms
  ) {
    doc.setDrawColor(
      226,
      232,
      240
    );

    doc.line(
      left,
      y,
      right,
      y
    );

    y += 7;

    if (invoice.notes) {
      doc.setFont(
        'helvetica',
        'bold'
      );
      doc.setFontSize(8);
      doc.setTextColor(
        100,
        116,
        139
      );
      doc.text(
        'NOTES',
        left,
        y
      );

      y += 4;

      doc.setFont(
        'helvetica',
        'normal'
      );
      doc.setTextColor(
        71,
        84,
        103
      );

      const lines =
        doc.splitTextToSize(
          String(invoice.notes),
          175
        );

      doc.text(lines, left, y);

      y +=
        lines.length * 4 +
        4;
    }

    if (invoice.terms) {
      doc.setFont(
        'helvetica',
        'bold'
      );
      doc.setFontSize(8);
      doc.setTextColor(
        100,
        116,
        139
      );
      doc.text(
        'TERMS',
        left,
        y
      );

      y += 4;

      doc.setFont(
        'helvetica',
        'normal'
      );
      doc.setTextColor(
        71,
        84,
        103
      );

      const lines =
        doc.splitTextToSize(
          String(invoice.terms),
          175
        );

      doc.text(lines, left, y);
    }
  }

  // Payment summary on a new page only if needed.
  if (payments.length) {
    doc.addPage();
    y = 18;

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setTextColor(
      17,
      24,
      39
    );

    doc.setFontSize(14);
    doc.text(
      'Payment history',
      left,
      y
    );

    y += 8;

    doc.setFontSize(8);

    for (const payment of payments) {
      doc.setFont(
        'helvetica',
        'normal'
      );

      doc.text(
        safe(payment.payment_date),
        left,
        y
      );

      doc.text(
        statusText(
          payment.payment_method
        ),
        55,
        y
      );

      doc.text(
        safe(
          payment.reference_number
        ),
        105,
        y
      );

      doc.setFont(
        'helvetica',
        'bold'
      );

      doc.text(
        fmt(
          payment.amount,
          payment.currency ||
            invoice.currency
        ),
        right,
        y,
        { align: 'right' }
      );

      y += 7;
    }
  }

  // Footer on every page
  const totalPages =
    doc.internal.getNumberOfPages();

  for (
    let page = 1;
    page <= totalPages;
    page += 1
  ) {
    doc.setPage(page);

    doc.setFontSize(7.5);
    doc.setFont(
      'helvetica',
      'normal'
    );
    doc.setTextColor(
      148,
      163,
      184
    );

    doc.text(
      `Generated from Insight MCSITOBES • Page ${page} of ${totalPages}`,
      pageWidth / 2,
      289,
      { align: 'center' }
    );
  }

  const fileName =
    `${invoice.invoice_number || 'sales-invoice'}.pdf`
      .replace(
        /[^\w.-]+/g,
        '-'
      );

  doc.save(fileName);
}