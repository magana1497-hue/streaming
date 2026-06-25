// AUTOR:        irving.romero
// FECHA:        16/08/2024
// DESCRIPCION:  CONTAR LOS ELEMENTOS DE LA LISTA HTML Y COLOCAR LA CANTIDAD DE FORMA DINAMICA COMO BADGE
const numOfLis = $("div .consultas ul li").length
$("#badgeCount").text(numOfLis);
// console.log($("div .consultas ul li").length);

function mostrarMensaje(titulo, tipo, texto, confirmarBtn, confirmaBtnText, cancelText, colorText, colorBtn) {
    // AUTOR:           irving.romero
    // FECHA:           19/08/2024
    // DESCRIPCION:     METODO DE JAVASCRIPT PARA EL MANEJO DINAMICO DE LOS MENSAJES
    // PARAMETROS:      titulo: string; tipo: string; confirmarBtn: bool; confirmarBtnText: string; cancelText: string; colorText: string; colorBtn: string

    const icon = tipo === 'success' ? 'success' : tipo === 'error' ? 'error' : tipo === 'save' ? 'success' : tipo === 'warning' ? 'warning' : 'info';
    const confirmButtonText = confirmarBtn ? 'Confirmar' : confirmaBtnText === undefined ? 'Ok' : confirmaBtnText;
    // console.log(confirmarBtn ? 'Confirmar' : confirmaBtnText === undefined ? 'Ok' : confirmaBtnText);

    cancelText = cancelText === undefined ? 'Cancelar' : cancelText;

    if (colorText === '' || colorText === undefined || colorText === null) {
        colorText = '#000';
    }
    if (colorBtn === '' || colorBtn === undefined || colorBtn === null) {
        colorBtn = '#7066e0';
    }


    $.blockUI({
        message: $("#divSpinner").show()
    });

    switch (tipo) {
        case 'save':
            Swal.fire({
                title: titulo,
                html: texto,
                icon: icon,
                color: colorText,
                confirmButtonColor: colorBtn,
                confirmButtonText: confirmButtonText,
                showCancelButton: confirmarBtn,
                cancelButtonText: cancelText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
        case 'success':
            Swal.fire({
                title: titulo,
                html: texto,
                icon: icon,
                color: colorText,
                confirmButtonColor: colorBtn,
                confirmButtonText: confirmButtonText,
                showCancelButton: confirmarBtn,
                cancelButtonText: cancelText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
        case 'error':
            Swal.fire({
                title: titulo,
                html: texto,
                icon: icon,
                confirmButtonColor: colorBtn,
                confirmButtonText: confirmButtonText,
                showCancelButton: confirmarBtn,
                cancelButtonText: cancelText,
                color: colorText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
        case 'info':
            Swal.fire({
                title: titulo,
                html: texto,
                icon: icon,
                color: colorText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
        case 'question':
            Swal.fire({
                title: titulo,
                html: texto,
                icon: icon,
                color: colorText,
                confirmButtonColor: colorBtn,
                confirmButtonText: confirmButtonText,
                showCancelButton: confirmarBtn,
                cancelButtonText: cancelText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
        case 'warning':
            Swal.fire({
                icon: icon,
                title: titulo,
                html: texto,
                confirmButtonColor: colorBtn,
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false,
                color: colorText,
                preConfirm: () => {
                    // console.log(texto);
                }
            });
            break;
    }

    $.unblockUI({
        onUnblock: function () {
            $("#divSpinner").hide();
        }
    });

    return;
}

function exportAction(e, dt, button, config, exportType) {
    if (dt.rows().count() === 0) {
        let titlo = 'No hay datos disponibles';
        let html = '<p>La tabla no posee datos para exportar.</p>';
        mostrarMensaje(titlo, 'warning',html );
    } else {
        $.fn.dataTable.ext.buttons[exportType].action.call(dt.button(button), e, dt, button, config);
    }
}
function crearTablaDinamica(idTabla, tiposDocumentos, columnasExportar, titulo, orientacionDoc, lengthMn, idAppend, paging, lengthCh, search,nombreArchivo) {
    // AUTOR:           irving.romero
    // FECHA:           21/08/2024
    // DESCRIPCION:     METODO DE JAVASCRIPT PARA EL MANEJO DE TABLAS
    //                  [idAppend-> donde se colocaran los botones de exportación;
    //                  por defecto (vacio) se colocán en tabla]
    // PARAMETROS:      idTabla: string; tiposDocumentos: Array[]; titulo: string;
    //                  orientacionDoc: string; lengthMn: Array[]; idAppen: string;
    //                  columnasExportar: Array[]
    let table = $(`#${idTabla}`).DataTable({
        dom: "Bfrtip",
        buttons: [tiposDocumentos.map(tipo => {
            switch (tipo) {
                case 'excel':
                    return {
                        extend: 'excel',
                        filename: nombreArchivo,
                        messageTop: titulo, className: 'exportExcel', attr: {
                            id: 'excelBtn'
                        }, exportOptions: {
                            columns: columnasExportar
                        }, action: function (e, dt, button, config) {
                            exportAction(e, dt, button, config, 'excelHtml5');
                        }
                    };
                case 'pdf':
                    return {
                        extend: 'pdf',
                        messageTop: titulo,
                        orientation: orientacionDoc,
                        className: 'exportPdf',
                        filename: nombreArchivo,
                        customize: function (doc) {
                            doc.content.unshift({
                                margin: [0, 0, 0, 12],
                                alignment: 'center',
                                image: 'data:image/png;base64,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'
                            });
                            doc.content.forEach(function (contentItem) {
                                if (contentItem.text && contentItem.text === titulo) {
                                    contentItem.alignment = 'center'; // Centrar el texto del título
                                }
                            });

                            if (doc.content && Array.isArray(doc.content)) {
                                doc.content.forEach(function (contentItem) {
                                    if (contentItem.table) {
                                        // Centrar la tabla
                                        contentItem.alignment = 'center';
                                        contentItem.table.widths = Array(contentItem.table.body[0].length).fill('*');
                                        contentItem.table.body.forEach(function (row) {
                                            row.forEach(function (cell) {
                                                cell.alignment = 'center'; // Centrar el contenido de la tabla
                                            });
                                        });
                                    }
                                });
                            }
                        },
                        attr: {
                            id: 'pdfBtn'
                        },
                        exportOptions: {
                            columns: columnasExportar
                        },
                        action: function (e, dt, button, config) {
                            exportAction(e, dt, button, config, 'pdfHtml5');
                        }
                    };
                case 'csv':
                    return {
                        extend: 'csv', messageTop: titulo, orientation: orientacionDoc, className: 'exportCSV', attr: {
                            id: 'csvBtn'
                        }, exportOptions: {
                            columns: columnasExportar
                        }, action: function (e, dt, button, config) {
                            exportAction(e, dt, button, config, 'csvHtml5');
                        }
                    };
                case 'copy':
                    return {
                        extend: 'copy',
                        messageTop: titulo,
                        orientation: orientacionDoc,
                        className: 'exportCopy',
                        attr: {
                            id: 'excelBtn'
                        },
                        exportOptions: {
                            columns: columnasExportar
                        },
                        action: function (e, dt, button, config) {
                            exportAction(e, dt, button, config, 'copyHtml5');
                        }
                    };
            }
        })],
        paging: paging,
        lengthChange: lengthCh,
        lengthMenu: lengthMn,

        searching: search,
        pageLength: 10,
        order: [[0, 'desc']],
        responsive: true, // select: {
        //     style: 'single'
        // },
        language: {
            search: "Buscar:",
            zeroRecords: "No hay datos",
            info: "Mostrar pagina _PAGE_ de _PAGES_ con un total de _TOTAL_ Registros",
            infoEmpty: "Sin Registros",
            lengthMenu: "Mostrar _MENU_ registros",
            loadingRecords: "Cargando...",
            paginate: {
                first: "Primero", last: "Último", previous: "Anterior", next: "Próximo"
            }, // select: {
            //     rows: '%d fila seleccionada'
            // }
        },
        columnDefs: [{
            targets: '_all', // Aplica a todas las columnas
            className: 'text-center-column'

        }]
    });
    if (idAppend !== '') {
        table.buttons().container().appendTo($(`#${idAppend}`));
        $('#excelBtn').removeClass();
        $('#excelBtn').addClass('btn btn-info');
        $('#pdfBtn').removeClass();
        $('#pdfBtn').addClass('btn btn-success');
    } else {
        //botones ubicacion por defecto
        table.buttons().container().appendTo($(`#${idTabla}_filter`));
    }
    return table;
}




function validarCampos(campos) {
    let mensaje = '<div><p class="mb-2">Debe de completar los campos requeridos</p><br>';
    let camposInvalidos = false;
    let label = "";

    campos.forEach(campo => {
        const { elemento, tipo } = campo;
        let valorInvalido = false;

        if (tipo === 'checkbox') {
            valorInvalido = !elemento.is(':checked');
            label = elemento.closest('.valida').find('.form-label').text();
        } else if (tipo === 'input') {
            valorInvalido = elemento.val() === '';
            label = elemento.parent().find('.form-label').text();
        }else if (tipo === 'select'){
            valorInvalido = (elemento.val() === null || elemento.val() === '' || elemento.val() ===  '000');
            label = elemento.parent().find('.form-label').text();
        }

        if (valorInvalido) {
            if (tipo === 'input'){
                elemento.each(isInvalidInput);
                elemento.on('change', isValidInput)
            }else if(tipo === 'select' || tipo === 'checkbox'){
                const label2 =  (tipo === 'select' ? elemento.parent().find('.form-label') : elemento.closest('.valida').find('.form-label'));
                label2.each(function () {
                    isValidCustome.call(this, 'form-label text-danger font-15 mdi mdi-alert-circle-outline');
                });
                elemento.on('change',function () {
                    isValidCustome.call(label2, 'form-label text-success font-15 mdi mdi-check-circle-outline');
                });
            }
            camposInvalidos = true;
            mensaje += `<span class="text-danger-emphasis">${label} <i class="mdi mdi-alert-circle-outline"></i></span><br>`;
        }
    });

    mensaje += '</div>';
    return { camposInvalidos, mensaje };
}