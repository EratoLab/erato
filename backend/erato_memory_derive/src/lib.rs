//! Derive owned-child traversal. Unknown fields must be explicitly annotated.
use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{Data, DeriveInput, Fields, Index, parse_macro_input};

#[proc_macro_derive(HeapSize, attributes(heap_size))]
pub fn derive_heap_size(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let mut generics = input.generics.clone();
    for parameter in generics.type_params_mut() {
        parameter
            .bounds
            .push(syn::parse_quote!(::erato_memory::HeapSize));
    }
    let (impl_generics, type_generics, where_clause) = generics.split_for_impl();
    let field_measure = |field: &syn::Field, value: proc_macro2::TokenStream| {
        let mut opaque = false;
        let mut skip = false;
        for attr in field
            .attrs
            .iter()
            .filter(|a| a.path().is_ident("heap_size"))
        {
            if let Err(error) = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("opaque") {
                    opaque = true;
                    Ok(())
                } else if meta.path.is_ident("skip") {
                    skip = true;
                    Ok(())
                } else {
                    Err(meta.error("expected opaque or skip"))
                }
            }) {
                return error.to_compile_error();
            }
        }
        if skip {
            quote! {}
        } else if opaque {
            quote! { context.opaque::<_>(#value); }
        } else {
            quote! { ::erato_memory::HeapSize::heap_size(#value, context); }
        }
    };
    let body = match &input.data {
        Data::Struct(data) => {
            let statements = data.fields.iter().enumerate().map(|(index, field)| {
                let member = field
                    .ident
                    .as_ref()
                    .map(|id| quote!(#id))
                    .unwrap_or_else(|| {
                        let index = Index::from(index);
                        quote!(#index)
                    });
                field_measure(field, quote!(&self.#member))
            });
            quote!(#(#statements)*)
        }
        Data::Enum(data) => {
            let arms = data.variants.iter().map(|variant| {
                let variant_name = &variant.ident;
                let bindings: Vec<_> = variant
                    .fields
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format_ident!("field_{i}"))
                    .collect();
                let statements = variant
                    .fields
                    .iter()
                    .zip(&bindings)
                    .map(|(field, binding)| field_measure(field, quote!(#binding)));
                let pattern = match &variant.fields {
                    Fields::Named(fields) => {
                        let names = fields
                            .named
                            .iter()
                            .map(|field| field.ident.as_ref().unwrap());
                        quote! { Self::#variant_name { #(#names: #bindings),* } }
                    }
                    Fields::Unnamed(_) => quote! { Self::#variant_name(#(#bindings),*) },
                    Fields::Unit => quote! { Self::#variant_name },
                };
                quote! { #pattern => { #(#statements)* } }
            });
            quote! { match self { #(#arms),* } }
        }
        Data::Union(_) => {
            return syn::Error::new_spanned(name, "HeapSize does not support unions")
                .to_compile_error()
                .into();
        }
    };
    quote! {
        impl #impl_generics ::erato_memory::HeapSize for #name #type_generics #where_clause {
            fn heap_size(&self, context: &mut ::erato_memory::Context) { #body }
        }
    }
    .into()
}
