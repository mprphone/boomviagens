// Validacao de ficheiros carregados (tamanho + assinatura de bytes real) -
// nunca confiar no mimeType que o pedido diz que o ficheiro e. Partilhado
// entre o upload do cliente e o do backoffice (ver auditoria: o do
// backoffice nao tinha nenhuma destas duas verificacoes).

// allowOffice: o backoffice tambem aceita o tipo "OTHER" (contratos,
// folhas de calculo de fornecedores, etc.) - a Area de Cliente so mostra
// documentos de viagem, que na pratica sao sempre PDF/imagem, por isso
// mantem a mensagem e o alcance originais.
function sniffAndValidate(buffer, { allowOffice = false } = {}) {
  if (!buffer || buffer.length < 4 || buffer.length > 7 * 1024 * 1024) {
    return { ok: false, error: 'O documento deve ter entre 4 bytes e 7 MB.' };
  }
  const isPdf = buffer.subarray(0, 4).toString('ascii') === '%PDF';
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPdf || isJpeg || isPng) {
    return { ok: true, verifiedMimeType: isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg' };
  }
  if (allowOffice) {
    // docx/xlsx/pptx/odt/ods (zip) ou doc/xls/ppt antigos (OLE) - o
    // conteudo real ainda nao e inspecionado, so o tipo de contentor, mas
    // ja impede que um ficheiro executavel/HTML disfarcado de "documento"
    // passe so por o pedido dizer que e Word/Excel.
    const isZipOffice = buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05) && (buffer[3] === 0x04 || buffer[3] === 0x06);
    const isOleOffice = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (isZipOffice) return { ok: true, verifiedMimeType: 'application/octet-stream' };
    if (isOleOffice) return { ok: true, verifiedMimeType: 'application/octet-stream' };
  }
  return { ok: false, error: allowOffice ? 'Formato não permitido. Use PDF, JPG, PNG, Word, Excel ou PowerPoint.' : 'Formato não permitido. Use PDF, JPG ou PNG.' };
}

module.exports = { sniffAndValidate };
